import { httpsCallable } from "firebase/functions";
import { getToken as getAppCheckToken } from "firebase/app-check";
import { auth, functions, getInitializedAppCheck } from "./firebase";

export interface TokenEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotal: number;
  estimatedCostUsd?: number;
  estimatedPairInputTokens?: number;
  estimatedPairOutputTokens?: number;
  estimatedPairTotal?: number;
  estimatedPairCostUsd?: number;
  estimatedGifCredits?: number;
  estimatedRawGifCredits?: number;
  estimatedDisplayGifCredits?: number;
  estimatedSafetyMarginRate?: number;
  billingDisplayWholeCredits?: boolean;
  creditPrecisionDecimals?: number;
  billingRoundedToWholeCredits?: boolean;
}

export interface GenerateResult {
  text: string;
  thoughts: string | null;
  tokensUsed: number;
  remainingBalance: number;
  chargedCreditsThisAction?: number;
  additionalChargedCredits?: number;
  finalGifCreditsForPair?: number | null;
  rawGifCreditsForPair?: number | null;
  displayGifCreditsForPair?: number | null;
  billingDisplayWholeCredits?: boolean;
  creditPrecisionDecimals?: number;
  usageEstimatedFallback?: boolean;
  billingRoundedToWholeCredits?: boolean;
}

export interface BalanceResult {
  balance: number;
}

export interface PurchaseVerifyResult {
  alreadyCredited: boolean;
  balance: number;
  creditsGranted?: number;
  tokensGranted?: number;
}

export interface DeleteAccountResult {
  deleted: boolean;
}

interface EstimateTokenRequest {
  action: string;
  prompt?: string;
  svgCode?: string;
  critique?: string;
  plan?: string;
  iteration?: number;
}

interface GenerateWithTokensRequest {
  action: string;
  sessionId: string;
  prompt?: string;
  svgCode?: string;
  critique?: string;
  plan?: string;
  imageBase64?: string;
  iteration?: number;
}

interface GetBalanceRequest {}

interface VerifyPurchaseRequest {
  purchaseToken: string;
  productId: string;
}

interface DeleteMyAccountRequest {}

const GENERATE_WITH_TOKENS_TIMEOUT_MS = 10 * 60 * 1000;

type StreamCallbacks = {
  onThoughtChunk?: (chunk: string) => void;
  onOutputChunk?: (chunk: string) => void;
  onStatus?: (status: string) => void;
};

const getFunctionsBaseUrl = (): string => {
  const explicitBaseUrl = String(import.meta.env.VITE_FUNCTIONS_BASE_URL || "").trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, "");
  }

  const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) {
    throw new Error("Missing VITE_FIREBASE_PROJECT_ID for streaming generation endpoint");
  }
  const region = String(import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1").trim();
  return `https://${region}-${projectId}.cloudfunctions.net`;
};

const parseSseEvent = (rawEvent: string): { event: string; data: unknown } | null => {
  const lines = rawEvent
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith(":"));

  if (lines.length === 0) return null;

  let event = "message";
  const dataParts: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataParts.push(line.slice("data:".length).trim());
    }
  }

  const dataText = dataParts.join("\n");
  if (!dataText) return { event, data: null };

  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: dataText };
  }
};

const getOptionalAppCheckToken = async (): Promise<string | null> => {
  try {
    const appCheck = getInitializedAppCheck();
    if (!appCheck) return null;
    const result = await getAppCheckToken(appCheck, false);
    return result?.token || null;
  } catch {
    return null;
  }
};

export const estimateTokenCost = async (
  action: string,
  params: {
    prompt?: string;
    svgCode?: string;
    critique?: string;
    plan?: string;
    iteration?: number;
  }
): Promise<TokenEstimate> => {
  const fn = httpsCallable<EstimateTokenRequest, TokenEstimate>(functions, "estimateTokenCost");
  const payload: EstimateTokenRequest = { action, ...params };
  const result = await fn(payload);
  return result.data;
};

export const generateWithTokens = async (
  action: string,
  sessionId: string,
  params: {
    prompt?: string;
    svgCode?: string;
    critique?: string;
    plan?: string;
    imageBase64?: string;
    iteration?: number;
  }
): Promise<GenerateResult> => {
  const fn = httpsCallable<GenerateWithTokensRequest, GenerateResult>(
    functions,
    "generateWithTokens",
    { timeout: GENERATE_WITH_TOKENS_TIMEOUT_MS }
  );
  const payload: GenerateWithTokensRequest = { action, sessionId, ...params };
  const result = await fn(payload);
  return result.data;
};

export const generateWithTokensStream = async (
  action: string,
  sessionId: string,
  params: {
    prompt?: string;
    svgCode?: string;
    critique?: string;
    plan?: string;
    imageBase64?: string;
    iteration?: number;
  },
  callbacks?: StreamCallbacks
): Promise<GenerateResult> => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Must be signed in");
  }

  const [idToken, appCheckToken] = await Promise.all([
    user.getIdToken(),
    getOptionalAppCheckToken(),
  ]);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), GENERATE_WITH_TOKENS_TIMEOUT_MS);
  const payload: GenerateWithTokensRequest = { action, sessionId, ...params };

  try {
    const response = await fetch(`${getFunctionsBaseUrl()}/streamGenerateWithTokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
        ...(appCheckToken ? { "X-Firebase-AppCheck": appCheckToken } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      let serverMessage = `Streaming request failed (${response.status})`;
      try {
        const maybeJson = await response.json();
        if (maybeJson?.error && typeof maybeJson.error === "string") {
          serverMessage = maybeJson.error;
        }
      } catch {
        // Ignore non-JSON response payloads.
      }
      throw new Error(serverMessage);
    }

    if (!response.body) {
      throw new Error("Streaming is not supported in this environment");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let completeResult: GenerateResult | null = null;
    let streamError: string | null = null;

    const consumeBuffer = () => {
      const nextDelimiter = (): { index: number; length: number } | null => {
        const lfIndex = buffer.indexOf("\n\n");
        const crlfIndex = buffer.indexOf("\r\n\r\n");
        if (lfIndex < 0 && crlfIndex < 0) return null;
        if (lfIndex < 0) return { index: crlfIndex, length: 4 };
        if (crlfIndex < 0) return { index: lfIndex, length: 2 };
        return lfIndex < crlfIndex
          ? { index: lfIndex, length: 2 }
          : { index: crlfIndex, length: 4 };
      };

      let delimiter = nextDelimiter();
      while (delimiter) {
        const rawEvent = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter.length);
        const parsed = parseSseEvent(rawEvent);
        if (parsed) {
          const payloadData = (parsed.data || {}) as Record<string, unknown>;
          if (parsed.event === "status") {
            const stage = typeof payloadData.stage === "string" ? payloadData.stage : "working";
            callbacks?.onStatus?.(stage);
          } else if (parsed.event === "thought") {
            const chunk = typeof payloadData.chunk === "string" ? payloadData.chunk : "";
            if (chunk) callbacks?.onThoughtChunk?.(chunk);
          } else if (parsed.event === "output") {
            const chunk = typeof payloadData.chunk === "string" ? payloadData.chunk : "";
            if (chunk) callbacks?.onOutputChunk?.(chunk);
          } else if (parsed.event === "complete") {
            completeResult = payloadData as unknown as GenerateResult;
          } else if (parsed.event === "error") {
            streamError = typeof payloadData.message === "string"
              ? payloadData.message
              : "Generation failed";
          }
        }
        delimiter = nextDelimiter();
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeBuffer();
      if (streamError) break;
    }

    buffer += decoder.decode();
    consumeBuffer();

    if (streamError) {
      throw new Error(streamError);
    }

    if (!completeResult) {
      throw new Error("Generation stream ended before completion");
    }

    return completeResult;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Generation timed out");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const getBalance = async (): Promise<number> => {
  const fn = httpsCallable<GetBalanceRequest, BalanceResult>(functions, "getBalance");
  const result = await fn({});
  return result.data.balance;
};

export const verifyPurchase = async (
  purchaseToken: string,
  productId: string
): Promise<PurchaseVerifyResult> => {
  const fn = httpsCallable<VerifyPurchaseRequest, PurchaseVerifyResult>(functions, "verifyAndCreditPurchase");
  const payload: VerifyPurchaseRequest = { purchaseToken, productId };
  const result = await fn(payload);
  return result.data;
};

export const deleteMyAccount = async (): Promise<boolean> => {
  const fn = httpsCallable<DeleteMyAccountRequest, DeleteAccountResult>(functions, "deleteMyAccount");
  const result = await fn({});
  return !!result.data.deleted;
};

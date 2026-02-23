import * as admin from "firebase-admin";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import { createHash } from "node:crypto";

admin.initializeApp();
const db = admin.firestore();

// Gemini API client (server's own key)
const getGeminiClient = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpsError("failed-precondition", "Server Gemini API key not configured");
  return new GoogleGenAI({ apiKey: key });
};

// Product ID mapping
type BillingAction = "plan" | "generate" | "evaluate" | "refine";
const BILLING_ACTIONS: BillingAction[] = ["plan", "generate", "evaluate", "refine"];

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Product IDs stay unchanged so Play Billing integration remains stable.
// Unit is now GIF credits instead of raw tokens.
const GIF_PACKS: Record<string, number> = {
  token_pack_tier1: 2,
  token_pack_tier2: 10,
  token_pack_tier3: 40,
  token_pack_tier4: 200,
};

// Estimated output tokens by action type (used for reservation/UX estimates).
const OUTPUT_ESTIMATES: Record<BillingAction, number> = {
  plan: numberFromEnv(process.env.ESTIMATED_PLAN_OUTPUT_TOKENS, 1_000),
  generate: numberFromEnv(process.env.ESTIMATED_GENERATE_OUTPUT_TOKENS, 12_000),
  evaluate: numberFromEnv(process.env.ESTIMATED_EVALUATE_OUTPUT_TOKENS, 500),
  refine: numberFromEnv(process.env.ESTIMATED_REFINE_OUTPUT_TOKENS, 12_000),
};

const FOLLOW_UP_INPUT_MULTIPLIERS: Record<BillingAction, number> = {
  plan: numberFromEnv(process.env.PLAN_FOLLOW_UP_INPUT_MULTIPLIER, 1.1),
  generate: 0,
  evaluate: numberFromEnv(process.env.EVALUATE_FOLLOW_UP_INPUT_MULTIPLIER, 1.1),
  refine: 0,
};

const FOLLOW_UP_OUTPUT_ESTIMATES: Record<BillingAction, number> = {
  plan: OUTPUT_ESTIMATES.generate,
  generate: 0,
  evaluate: OUTPUT_ESTIMATES.refine,
  refine: 0,
};

const INPUT_TOKEN_COST_PER_MILLION_USD = numberFromEnv(process.env.INPUT_TOKEN_COST_PER_MILLION_USD, 2);
const OUTPUT_TOKEN_COST_PER_MILLION_USD = numberFromEnv(process.env.OUTPUT_TOKEN_COST_PER_MILLION_USD, 12);
const CREDIT_GROSS_PRICE_USD = numberFromEnv(process.env.CREDIT_GROSS_PRICE_USD, 0.5);
const PLAY_STORE_FEE_RATE = numberFromEnv(process.env.PLAY_STORE_FEE_RATE, 0.15);
const TAX_RATE = numberFromEnv(process.env.TAX_RATE, 0.3);
const BILLING_SAFETY_MARGIN_RATE = Math.max(0, numberFromEnv(process.env.BILLING_SAFETY_MARGIN_RATE, 0.03));
const BASELINE_CREDITS = Math.max(0, numberFromEnv(process.env.BASELINE_CREDITS, 0.85));
const BASELINE_CREDITS_DECAY = Math.max(0.01, numberFromEnv(process.env.BASELINE_CREDITS_DECAY, 0.35));
const MIN_BILLED_CREDITS = Math.max(0, numberFromEnv(process.env.MIN_BILLED_CREDITS, 0.01));
const CREDIT_DECIMALS = Math.min(4, Math.max(2, Math.floor(numberFromEnv(process.env.CREDIT_DECIMALS, 3))));
const INPUT_TOKEN_CAP = Math.max(1, Math.floor(numberFromEnv(process.env.INPUT_TOKEN_CAP, 199_999)));
const CREDIT_PRECISION_FACTOR = 10 ** CREDIT_DECIMALS;
const EPSILON = 1e-9;

const CREDIT_NET_PRICE_USD = CREDIT_GROSS_PRICE_USD * (1 - PLAY_STORE_FEE_RATE) * (1 - TAX_RATE);

const MODEL = "gemini-3.1-pro-preview";
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";
export const ANDROID_PACKAGE_NAME = "com.ronitervo.ideatesvg";

const purchaseDocIdFromToken = (purchaseToken: string): string => {
  return createHash("sha256").update(purchaseToken).digest("hex");
};

const isAlreadyExistsError = (error: unknown): boolean => {
  const code = (error as { code?: unknown })?.code;
  const message = ((error as { message?: string })?.message || "").toLowerCase();
  return code === 6 || code === "already-exists" || message.includes("already exists");
};

const isAlreadyConsumedError = (error: unknown): boolean => {
  const message = ((error as { message?: string })?.message || "").toLowerCase();
  return message.includes("already consumed") || message.includes("consumption state");
};

const parseCallableBody = (body: unknown): Record<string, unknown> => {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      throw new HttpsError("invalid-argument", "Invalid JSON body");
    }
  }
  if (typeof body === "object") {
    return body as Record<string, unknown>;
  }
  throw new HttpsError("invalid-argument", "Invalid request body");
};

const setCorsHeaders = (req: any, res: any): void => {
  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Firebase-AppCheck"
  );
};

const requireAuthenticatedUidFromRequest = async (req: any): Promise<string> => {
  const authHeader = String(req.headers?.authorization || "");
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new HttpsError("unauthenticated", "Missing Authorization bearer token");
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    throw new HttpsError("unauthenticated", "Missing Authorization bearer token");
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded?.uid) {
      throw new HttpsError("unauthenticated", "Invalid auth token");
    }
    return decoded.uid;
  } catch {
    throw new HttpsError("unauthenticated", "Invalid auth token");
  }
};

const verifyAppCheckFromRequest = async (req: any): Promise<void> => {
  if (!ENFORCE_APP_CHECK) return;

  const appCheckToken = String(req.headers?.["x-firebase-appcheck"] || "");
  if (!appCheckToken) {
    throw new HttpsError("failed-precondition", "App Check token is required");
  }

  try {
    await admin.appCheck().verifyToken(appCheckToken);
  } catch {
    throw new HttpsError("failed-precondition", "Invalid App Check token");
  }
};

const writeSseEvent = (res: any, event: string, data: unknown): void => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const getSessionRef = (uid: string, sessionId: string) =>
  db.collection("generationSessions").doc(`${uid}_${sessionId}`);

const isValidSessionId = (sessionId: unknown): sessionId is string => {
  return typeof sessionId === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(sessionId);
};

const roundCredits = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * CREDIT_PRECISION_FACTOR) / CREDIT_PRECISION_FACTOR;
};

const roundCreditsNonNegative = (value: number): number => {
  return Math.max(0, roundCredits(value));
};

const ceilCredits = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.ceil(Math.max(0, value) * CREDIT_PRECISION_FACTOR) / CREDIT_PRECISION_FACTOR;
};

const toDisplayCredits = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.ceil(Math.max(0, value)));
};

const isChargeAction = (action: BillingAction): boolean => {
  return action === "plan" || action === "evaluate";
};

const assertInputTokenCap = (inputTokens: number): void => {
  if (inputTokens >= INPUT_TOKEN_CAP) {
    throw new HttpsError(
      "invalid-argument",
      `Input too large (${inputTokens} tokens). Keep input below ${INPUT_TOKEN_CAP} tokens.`
    );
  }
};

const actionUsageCostUsd = (usage: {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}): number => {
  const inputCost = (usage.inputTokens / 1_000_000) * INPUT_TOKEN_COST_PER_MILLION_USD;
  // Thought tokens are billed as generation output in practice, so price them with output.
  const outputCost = ((usage.outputTokens + usage.thoughtTokens) / 1_000_000) * OUTPUT_TOKEN_COST_PER_MILLION_USD;
  return inputCost + outputCost;
};

type GifBillingComputation = {
  rawCredits: number;
  billedCredits: number;
  displayCredits: number;
};

const applySmoothCreditCurve = (rawCredits: number): number => {
  const safetyAdjusted = rawCredits * (1 + BILLING_SAFETY_MARGIN_RATE);
  const lowCostBoost = BASELINE_CREDITS * Math.exp(-rawCredits / BASELINE_CREDITS_DECAY);
  return safetyAdjusted + lowCostBoost;
};

const computeGifBilling = (pairCostUsd: number): GifBillingComputation => {
  if (CREDIT_NET_PRICE_USD <= 0) {
    throw new HttpsError("failed-precondition", "Invalid credit pricing configuration");
  }

  const rawCredits = pairCostUsd / CREDIT_NET_PRICE_USD;
  const curveCredits = applySmoothCreditCurve(rawCredits);
  const billedCredits = Math.max(MIN_BILLED_CREDITS, ceilCredits(curveCredits));

  return {
    rawCredits: roundCredits(rawCredits),
    billedCredits,
    displayCredits: toDisplayCredits(billedCredits),
  };
};

const creditsForGifOutput = (pairCostUsd: number): number => {
  return computeGifBilling(pairCostUsd).billedCredits;
};

const estimatePairForAction = (
  action: BillingAction,
  inputTokens: number
): {
  estimatedOutputTokens: number;
  pairInputTokens: number;
  pairOutputTokens: number;
  pairTotalTokens: number;
  pairUsd: number;
} => {
  const estimatedOutputTokens = OUTPUT_ESTIMATES[action] || 2_000;
  const followUpInputMultiplier = FOLLOW_UP_INPUT_MULTIPLIERS[action] || 0;
  const followUpOutputTokens = FOLLOW_UP_OUTPUT_ESTIMATES[action] || 0;
  const pairInputTokens = Math.ceil(inputTokens * (1 + followUpInputMultiplier));
  const pairOutputTokens = Math.ceil(estimatedOutputTokens + followUpOutputTokens);
  const pairTotalTokens = pairInputTokens + pairOutputTokens;
  const pairUsd = actionUsageCostUsd({
    inputTokens: pairInputTokens,
    outputTokens: pairOutputTokens,
    thoughtTokens: 0,
  });
  return {
    estimatedOutputTokens,
    pairInputTokens,
    pairOutputTokens,
    pairTotalTokens,
    pairUsd,
  };
};

const getUserBalance = async (uid: string): Promise<number> => {
  const doc = await db.collection("users").doc(uid).get();
  return doc.exists ? roundCredits(Number(doc.data()?.balance) || 0) : 0;
};

const consumePurchase = async (
  androidPublisher: any,
  productId: string,
  purchaseToken: string
): Promise<void> => {
  try {
    await androidPublisher.purchases.products.consume({
      packageName: ANDROID_PACKAGE_NAME,
      productId,
      token: purchaseToken,
    });
  } catch (consumeError) {
    if (!isAlreadyConsumedError(consumeError)) {
      throw consumeError;
    }
  }
};

type ReservationResult = {
  provisionalChargedCredits: number;
  remainingBalance: number;
};

type UsageMetrics = {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  totalUsd: number;
};

type BillingSettlementResult = {
  remainingBalance: number;
  additionalChargedCredits: number;
  pairCreditsCharged: number | null;
  pairRawCredits: number | null;
  pairDisplayCredits: number | null;
};

type BillingSettlementOptions = {
  rollbackOnly?: boolean;
  provisionalChargedCredits?: number;
  failureReason?: string;
};

type PendingPairFieldSet = {
  pendingCostUsdField: "pendingPlanCostUsd" | "pendingEvaluateCostUsd";
  pendingTokensField: "pendingPlanTokens" | "pendingEvaluateTokens";
  pendingReservedCreditsField: "pendingPlanReservedCredits" | "pendingEvaluateReservedCredits";
};

type PendingPairState = {
  pendingCostUsd: number;
  pendingTokens: number;
  pendingReservedCredits: number;
};

type ValidatedGenerationContext = {
  typedAction: BillingAction;
  sessionId: string;
  contents: PromptContents;
  ai: GoogleGenAI;
  estimatedInputTokens: number;
  pairEstimate: ReturnType<typeof estimatePairForAction>;
};

const ZERO_USAGE_METRICS: UsageMetrics = {
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  totalTokens: 0,
  totalUsd: 0,
};

const pendingPairFieldsForAction = (action: BillingAction): PendingPairFieldSet | null => {
  if (action === "generate") {
    return {
      pendingCostUsdField: "pendingPlanCostUsd",
      pendingTokensField: "pendingPlanTokens",
      pendingReservedCreditsField: "pendingPlanReservedCredits",
    };
  }
  if (action === "refine") {
    return {
      pendingCostUsdField: "pendingEvaluateCostUsd",
      pendingTokensField: "pendingEvaluateTokens",
      pendingReservedCreditsField: "pendingEvaluateReservedCredits",
    };
  }
  return null;
};

const reservationFieldsForAction = (action: BillingAction): PendingPairFieldSet => {
  if (action === "plan" || action === "generate") {
    return {
      pendingCostUsdField: "pendingPlanCostUsd",
      pendingTokensField: "pendingPlanTokens",
      pendingReservedCreditsField: "pendingPlanReservedCredits",
    };
  }
  return {
    pendingCostUsdField: "pendingEvaluateCostUsd",
    pendingTokensField: "pendingEvaluateTokens",
    pendingReservedCreditsField: "pendingEvaluateReservedCredits",
  };
};

const stalePairStateError = (action: BillingAction): HttpsError => {
  if (action === "generate") {
    return new HttpsError(
      "failed-precondition",
      "Planning state is stale. Run planning again before generate."
    );
  }
  if (action === "refine") {
    return new HttpsError(
      "failed-precondition",
      "Evaluation state is stale. Run evaluation again before refine."
    );
  }
  return new HttpsError("failed-precondition", "Pending billing state is stale. Retry the previous step.");
};

const readRequiredPendingPairState = (
  action: BillingAction,
  sessionData: FirebaseFirestore.DocumentData
): PendingPairState => {
  const fields = pendingPairFieldsForAction(action);
  if (!fields) {
    throw new HttpsError("invalid-argument", "Pending pair state is not required for this action");
  }

  const pendingCostUsd = Number(sessionData[fields.pendingCostUsdField]);
  const pendingTokens = Number(sessionData[fields.pendingTokensField]);
  const pendingReservedCredits = roundCreditsNonNegative(Number(sessionData[fields.pendingReservedCreditsField]) || 0);
  const hasPendingCost = Number.isFinite(pendingCostUsd) && pendingCostUsd > EPSILON;
  const hasPendingTokens = Number.isFinite(pendingTokens) && pendingTokens > 0;

  if (!hasPendingCost || !hasPendingTokens || pendingReservedCredits <= EPSILON) {
    throw stalePairStateError(action);
  }

  return {
    pendingCostUsd,
    pendingTokens,
    pendingReservedCredits,
  };
};

const reserveCreditsForAction = async (
  uid: string,
  sessionId: string,
  action: BillingAction,
  provisionalChargeEstimate: number
): Promise<ReservationResult> => {
  const userRef = db.collection("users").doc(uid);
  const sessionRef = getSessionRef(uid, sessionId);

  const pendingGenerateDelta = action === "plan" ? 1 : action === "generate" ? -1 : 0;
  const pendingRefineDelta = action === "evaluate" ? 1 : action === "refine" ? -1 : 0;
  const requestedReserve = roundCreditsNonNegative(provisionalChargeEstimate);

  return db.runTransaction(async (tx) => {
    const [userDoc, sessionDoc] = await Promise.all([tx.get(userRef), tx.get(sessionRef)]);
    const currentBalance = userDoc.exists ? roundCredits(Number(userDoc.data()?.balance) || 0) : 0;
    const sessionData = sessionDoc.data() || {};
    const currentPendingGenerate = sessionDoc.exists ? (Number(sessionData.pendingGenerate) || 0) : 0;
    const currentPendingRefine = sessionDoc.exists ? (Number(sessionData.pendingRefine) || 0) : 0;
    const currentPlanReservedCredits = roundCreditsNonNegative(Number(sessionData.pendingPlanReservedCredits) || 0);
    const currentEvaluateReservedCredits = roundCreditsNonNegative(Number(sessionData.pendingEvaluateReservedCredits) || 0);
    const provisionalCharge =
      action === "generate"
        ? ceilCredits(Math.max(0, requestedReserve - currentPlanReservedCredits))
        : action === "refine"
          ? ceilCredits(Math.max(0, requestedReserve - currentEvaluateReservedCredits))
          : requestedReserve;

    if (action === "generate" || action === "refine") {
      readRequiredPendingPairState(action, sessionData);
    }

    if (pendingGenerateDelta < 0 && currentPendingGenerate < 1) {
      throw new HttpsError(
        "failed-precondition",
        "Generation steps out of order. Run planning before generate."
      );
    }

    if (pendingRefineDelta < 0 && currentPendingRefine < 1) {
      throw new HttpsError(
        "failed-precondition",
        "Generation steps out of order. Run evaluation before refine."
      );
    }

    if (currentBalance + EPSILON < provisionalCharge) {
      throw new HttpsError(
        "resource-exhausted",
        `Insufficient GIF credits. Balance: ${currentBalance}, required: ${provisionalCharge}`
      );
    }

    const newBalance = roundCredits(currentBalance - provisionalCharge);
    const newPendingGenerate = currentPendingGenerate + pendingGenerateDelta;
    const newPendingRefine = currentPendingRefine + pendingRefineDelta;

    tx.set(
      userRef,
      {
        balance: newBalance,
        gifBalance: newBalance,
        totalConsumed: admin.firestore.FieldValue.increment(provisionalCharge),
        creditDebt: roundCreditsNonNegative(-newBalance),
        hasNegativeBalance: newBalance < 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(userDoc.exists ? {} : {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          totalPurchased: 0,
        }),
      },
      { merge: true }
    );

    const sessionUpdate: Record<string, unknown> = {
      uid,
      sessionId,
      status: "active",
      pendingGenerate: newPendingGenerate,
      pendingRefine: newPendingRefine,
      creditsConsumed: admin.firestore.FieldValue.increment(provisionalCharge),
      actionCount: admin.firestore.FieldValue.increment(1),
      lastAction: action,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(sessionDoc.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    };

    if (action === "plan") {
      sessionUpdate.pendingPlanReservedCredits = provisionalCharge;
      sessionUpdate.pendingPlanCostUsd = 0;
      sessionUpdate.pendingPlanTokens = 0;
    }
    if (action === "evaluate") {
      sessionUpdate.pendingEvaluateReservedCredits = provisionalCharge;
      sessionUpdate.pendingEvaluateCostUsd = 0;
      sessionUpdate.pendingEvaluateTokens = 0;
    }
    if (action === "generate") {
      sessionUpdate.pendingPlanReservedCredits = roundCreditsNonNegative(currentPlanReservedCredits + provisionalCharge);
    }
    if (action === "refine") {
      sessionUpdate.pendingEvaluateReservedCredits = roundCreditsNonNegative(currentEvaluateReservedCredits + provisionalCharge);
    }

    tx.set(
      sessionRef,
      sessionUpdate,
      { merge: true }
    );

    return {
      provisionalChargedCredits: provisionalCharge,
      remainingBalance: newBalance,
    };
  });
};

const settleGifOrEvaluate = ({
  action,
  fields,
  userRef,
  sessionRef,
  sessionData,
  usage,
  currentBalance,
  tx,
}: {
  action: "generate" | "refine";
  fields: PendingPairFieldSet;
  userRef: FirebaseFirestore.DocumentReference;
  sessionRef: FirebaseFirestore.DocumentReference;
  sessionData: FirebaseFirestore.DocumentData;
  usage: UsageMetrics;
  currentBalance: number;
  tx: FirebaseFirestore.Transaction;
}): {
  remainingBalance: number;
  additionalChargedCredits: number;
  pairCreditsCharged: number;
  pairRawCredits: number;
  pairDisplayCredits: number;
} => {
  const pendingState = readRequiredPendingPairState(action, sessionData);
  const pairCostUsd = pendingState.pendingCostUsd + usage.totalUsd;
  const pairTokens = pendingState.pendingTokens + usage.totalTokens;
  const pairBilling = computeGifBilling(pairCostUsd);
  const pairCredits = pairBilling.billedCredits;
  const additionalCredits = ceilCredits(Math.max(0, pairCredits - pendingState.pendingReservedCredits));
  const newBalance = roundCredits(currentBalance - additionalCredits);

  tx.set(
    userRef,
    {
      balance: newBalance,
      gifBalance: newBalance,
      totalConsumed: admin.firestore.FieldValue.increment(additionalCredits),
      creditDebt: roundCreditsNonNegative(-newBalance),
      hasNegativeBalance: newBalance < 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  tx.set(
    sessionRef,
    {
      [fields.pendingCostUsdField]: 0,
      [fields.pendingTokensField]: 0,
      [fields.pendingReservedCreditsField]: 0,
      lastGifCreditsCharged: pairCredits,
      lastGifRawCredits: pairBilling.rawCredits,
      lastDisplayGifCredits: pairBilling.displayCredits,
      lastCreditRoundingMode: `ceil_fractional_${CREDIT_DECIMALS}dp_show_whole`,
      lastGifCostUsd: pairCostUsd,
      lastGifTokens: pairTokens,
      creditsConsumed: admin.firestore.FieldValue.increment(additionalCredits),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    remainingBalance: newBalance,
    additionalChargedCredits: additionalCredits,
    pairCreditsCharged: pairCredits,
    pairRawCredits: pairBilling.rawCredits,
    pairDisplayCredits: pairBilling.displayCredits,
  };
};

const settleActionBilling = async (
  uid: string,
  sessionId: string,
  action: BillingAction,
  usage: UsageMetrics,
  options?: BillingSettlementOptions
): Promise<BillingSettlementResult> => {
  const userRef = db.collection("users").doc(uid);
  const sessionRef = getSessionRef(uid, sessionId);

  return db.runTransaction(async (tx) => {
    const [userDoc, sessionDoc] = await Promise.all([tx.get(userRef), tx.get(sessionRef)]);
    const currentBalance = userDoc.exists ? roundCredits(Number(userDoc.data()?.balance) || 0) : 0;
    const sessionData = sessionDoc.data() || {};

    if (options?.rollbackOnly) {
      const refundCredits = roundCreditsNonNegative(options.provisionalChargedCredits || 0);
      const currentPendingGenerate = sessionDoc.exists ? (Number(sessionData.pendingGenerate) || 0) : 0;
      const currentPendingRefine = sessionDoc.exists ? (Number(sessionData.pendingRefine) || 0) : 0;
      const pendingGenerateDelta = action === "plan" ? -1 : action === "generate" ? 1 : 0;
      const pendingRefineDelta = action === "evaluate" ? -1 : action === "refine" ? 1 : 0;
      const newBalance = roundCredits(currentBalance + refundCredits);

      if (refundCredits > 0) {
        tx.set(
          userRef,
          {
            balance: newBalance,
            gifBalance: newBalance,
            totalConsumed: admin.firestore.FieldValue.increment(-refundCredits),
            creditDebt: roundCreditsNonNegative(-newBalance),
            hasNegativeBalance: newBalance < 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(userDoc.exists ? {} : {
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              totalPurchased: 0,
            }),
          },
          { merge: true }
        );
      }

      const rollbackFields = reservationFieldsForAction(action);
      const currentReserved = roundCreditsNonNegative(Number(sessionData[rollbackFields.pendingReservedCreditsField]) || 0);
      const sessionUpdate: Record<string, unknown> = {
        uid,
        sessionId,
        status: "active",
        pendingGenerate: Math.max(0, currentPendingGenerate + pendingGenerateDelta),
        pendingRefine: Math.max(0, currentPendingRefine + pendingRefineDelta),
        [rollbackFields.pendingReservedCreditsField]: roundCreditsNonNegative(currentReserved - refundCredits),
        lastFailedAction: action,
        lastFailureReason: options.failureReason || "action_failed",
        lastFailedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(sessionDoc.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
      };

      if (action === "plan" || action === "evaluate") {
        sessionUpdate[rollbackFields.pendingCostUsdField] = 0;
        sessionUpdate[rollbackFields.pendingTokensField] = 0;
      }
      if (refundCredits > 0) {
        sessionUpdate.creditsConsumed = admin.firestore.FieldValue.increment(-refundCredits);
      }

      tx.set(sessionRef, sessionUpdate, { merge: true });

      return {
        remainingBalance: newBalance,
        additionalChargedCredits: 0,
        pairCreditsCharged: null,
        pairRawCredits: null,
        pairDisplayCredits: null,
      };
    }

    if (action === "plan") {
      tx.set(
        sessionRef,
        {
          pendingPlanCostUsd: usage.totalUsd,
          pendingPlanTokens: usage.totalTokens,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return {
        remainingBalance: currentBalance,
        additionalChargedCredits: 0,
        pairCreditsCharged: null,
        pairRawCredits: null,
        pairDisplayCredits: null,
      };
    }

    if (action === "evaluate") {
      tx.set(
        sessionRef,
        {
          pendingEvaluateCostUsd: usage.totalUsd,
          pendingEvaluateTokens: usage.totalTokens,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return {
        remainingBalance: currentBalance,
        additionalChargedCredits: 0,
        pairCreditsCharged: null,
        pairRawCredits: null,
        pairDisplayCredits: null,
      };
    }

    const fields = pendingPairFieldsForAction(action);
    if (!fields) {
      throw new HttpsError("failed-precondition", "Unsupported billing action for settlement");
    }

    const settled = settleGifOrEvaluate({
      action,
      fields,
      userRef,
      sessionRef,
      sessionData,
      usage,
      currentBalance,
      tx,
    });

    return {
      remainingBalance: settled.remainingBalance,
      additionalChargedCredits: settled.additionalChargedCredits,
      pairCreditsCharged: settled.pairCreditsCharged,
      pairRawCredits: settled.pairRawCredits,
      pairDisplayCredits: settled.pairDisplayCredits,
    };
  });
};

// ===== BILLING =====

export const verifyAndCreditPurchase = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }
    const uid = request.auth.uid;
    const { purchaseToken, productId } = request.data;

    if (!purchaseToken || !productId) {
      throw new HttpsError("invalid-argument", "Missing purchaseToken or productId");
    }

    const creditsToGrant = GIF_PACKS[productId];
    if (!creditsToGrant) {
      throw new HttpsError("invalid-argument", `Unknown product: ${productId}`);
    }

    const purchaseDocId = purchaseDocIdFromToken(purchaseToken);
    const purchaseRef = db.collection("purchases").doc(purchaseDocId);

    // Lock by purchase token hash to prevent duplicate crediting in concurrent requests.
    try {
      await purchaseRef.create({
        uid,
        productId,
        purchaseTokenHash: purchaseDocId,
        status: "processing",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        console.error("Failed to create purchase lock:", error);
        throw new HttpsError("internal", "Could not process purchase");
      }

      const existingSnap = await purchaseRef.get();
      const existing = existingSnap.data();

      if (!existingSnap.exists || !existing) {
        throw new HttpsError("aborted", "Purchase is already being processed. Please retry.");
      }

      if (existing.uid && existing.uid !== uid) {
        throw new HttpsError("permission-denied", "Purchase token belongs to a different user");
      }

      if (existing.status === "completed") {
        const safeBalance = typeof existing.balanceAfter === "number"
          ? existing.balanceAfter
          : await getUserBalance(uid);

        // Best-effort recovery for previously credited purchases where consume failed.
        if (existing.consumePending === true) {
          try {
            const auth = new google.auth.GoogleAuth({
              scopes: ["https://www.googleapis.com/auth/androidpublisher"],
            });
            const androidPublisher = google.androidpublisher({ version: "v3", auth });
            await consumePurchase(androidPublisher, productId, purchaseToken);
            await purchaseRef.set(
              {
                consumePending: false,
                consumeError: admin.firestore.FieldValue.delete(),
                consumedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          } catch (consumeRetryError: any) {
            console.error("Failed to recover pending consume:", consumeRetryError);
          }
        }

        return { alreadyCredited: true, balance: safeBalance };
      }

      if (existing.status === "failed") {
        await purchaseRef.set(
          {
            status: "processing",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        const updatedAtMs =
          typeof existing.updatedAt?.toMillis === "function"
            ? existing.updatedAt.toMillis()
            : typeof existing.createdAt?.toMillis === "function"
              ? existing.createdAt.toMillis()
              : 0;
        const isStaleProcessing = updatedAtMs > 0 && Date.now() - updatedAtMs > 5 * 60 * 1000;

        if (!isStaleProcessing) {
          throw new HttpsError("aborted", "Purchase is currently being processed. Please try again.");
        }

        await purchaseRef.set(
          {
            status: "processing",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

    }

    // Verify purchase with Google Play Developer API
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/androidpublisher"],
      });
      const androidPublisher = google.androidpublisher({ version: "v3", auth });

      const verification = await androidPublisher.purchases.products.get({
        packageName: ANDROID_PACKAGE_NAME,
        productId: productId,
        token: purchaseToken,
      });

      if (verification.data.purchaseState !== 0) {
        throw new HttpsError("failed-precondition", "Purchase not completed");
      }

      // If obfuscated account ID was set in BillingFlow, ensure token belongs to this uid.
      if (
        verification.data.obfuscatedExternalAccountId &&
        verification.data.obfuscatedExternalAccountId !== uid
      ) {
        throw new HttpsError("permission-denied", "Purchase token does not match signed-in user");
      }

      if (verification.data.consumptionState === 1) {
        // Already consumed before reaching this backend (or replayed token).
        // Mark as completed-without-credit to prevent duplicate grants.
        const currentBalance = await getUserBalance(uid);
        await purchaseRef.set(
          {
            uid,
            productId,
            purchaseTokenHash: purchaseDocId,
            orderId: verification.data.orderId || null,
            balanceAfter: currentBalance,
            status: "completed",
            creditsGranted: 0,
            tokensGranted: 0,
            consumedBeforeVerification: true,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return { alreadyCredited: true, balance: currentBalance };
      }

      // Credit GIF credits
      const userRef = db.collection("users").doc(uid);
      const newBalance = await db.runTransaction(async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentBalance = userDoc.exists ? roundCredits(Number(userDoc.data()?.balance) || 0) : 0;
        const newBal = roundCredits(currentBalance + creditsToGrant);

        tx.set(
          userRef,
          {
            balance: newBal,
            gifBalance: newBal,
            totalPurchased: admin.firestore.FieldValue.increment(creditsToGrant),
            creditDebt: roundCreditsNonNegative(-newBal),
            hasNegativeBalance: newBal < 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(userDoc.exists ? {} : {
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              totalConsumed: 0,
            }),
          },
          { merge: true }
        );

        return newBal;
      });

      // Persist completion immediately after credit to guarantee idempotency
      // even if consume hits a transient failure.
      await purchaseRef.set(
        {
          uid,
          productId,
          purchaseTokenHash: purchaseDocId,
          creditsGranted: creditsToGrant,
          tokensGranted: creditsToGrant,
          orderId: verification.data.orderId || null,
          balanceAfter: newBalance,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: "completed",
          consumePending: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      try {
        await consumePurchase(androidPublisher, productId, purchaseToken);
        await purchaseRef.set(
          {
            consumePending: false,
            consumeError: admin.firestore.FieldValue.delete(),
            consumedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (consumeError: any) {
        console.error("Purchase consumed failed after credit:", consumeError);
        await purchaseRef.set(
          {
            consumePending: true,
            consumeError: consumeError?.message || "consume_failed",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      return {
        alreadyCredited: false,
        balance: newBalance,
        creditsGranted: creditsToGrant,
        tokensGranted: creditsToGrant,
      };
    } catch (error: any) {
      const safeMessage = error instanceof HttpsError ? error.message : (error?.message || "verification_failed");
      await purchaseRef.set(
        {
          status: "failed",
          lastError: safeMessage,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ).catch((writeError) => {
        console.error("Failed to persist purchase failure state:", writeError);
      });

      if (error instanceof HttpsError) {
        throw error;
      }

      console.error("Purchase verification failed:", error);
      throw new HttpsError("internal", "Failed to verify purchase");
    }
  }
);

// ===== TOKEN ESTIMATION =====

export const estimateTokenCost = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const { action, prompt, svgCode, critique, plan, iteration } = request.data;

    if (typeof action !== "string" || !BILLING_ACTIONS.includes(action as BillingAction)) {
      throw new HttpsError("invalid-argument", "Invalid action");
    }
    const typedAction = action as BillingAction;

    const ai = getGeminiClient();
    const contents = buildPromptForAction(typedAction, { prompt, svgCode, critique, plan, iteration });

    const countResult = await ai.models.countTokens({
      model: MODEL,
      contents,
    });

    const inputTokens = countResult.totalTokens || 0;
    assertInputTokenCap(inputTokens);

    const pairEstimate = estimatePairForAction(typedAction, inputTokens);
    const estimatedOutput = pairEstimate.estimatedOutputTokens;
    const estimatedActionUsd = actionUsageCostUsd({
      inputTokens,
      outputTokens: estimatedOutput,
      thoughtTokens: 0,
    });
    const pairBilling = isChargeAction(typedAction)
      ? computeGifBilling(pairEstimate.pairUsd)
      : null;

    return {
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: estimatedOutput,
      estimatedTotal: inputTokens + estimatedOutput,
      estimatedCostUsd: estimatedActionUsd,
      estimatedPairInputTokens: pairEstimate.pairInputTokens,
      estimatedPairOutputTokens: pairEstimate.pairOutputTokens,
      estimatedPairTotal: pairEstimate.pairTotalTokens,
      estimatedPairCostUsd: pairEstimate.pairUsd,
      estimatedGifCredits: pairBilling?.billedCredits || 0,
      estimatedRawGifCredits: pairBilling?.rawCredits || 0,
      estimatedDisplayGifCredits: pairBilling?.displayCredits || 0,
      estimatedSafetyMarginRate: BILLING_SAFETY_MARGIN_RATE,
      billingDisplayWholeCredits: true,
      creditPrecisionDecimals: CREDIT_DECIMALS,
      billingRoundedToWholeCredits: false,
    };
  }
);

// ===== GET BALANCE =====

export const getBalance = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }
    const uid = request.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      // Create user doc with 0 GIF credits
      await db.collection("users").doc(uid).set({
        balance: 0,
        gifBalance: 0,
        totalPurchased: 0,
        totalConsumed: 0,
        creditDebt: 0,
        hasNegativeBalance: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { balance: 0 };
    }

    return { balance: roundCredits(Number(userDoc.data()?.balance) || 0) };
  }
);

// ===== GENERATE WITH GIF CREDITS =====

const validateAndBuildContents = async (
  rawData: Record<string, unknown>
): Promise<ValidatedGenerationContext> => {
  const actionRaw = rawData.action;
  const sessionIdRaw = rawData.sessionId;

  if (typeof actionRaw !== "string" || !BILLING_ACTIONS.includes(actionRaw as BillingAction)) {
    throw new HttpsError("invalid-argument", "Invalid action");
  }
  if (!isValidSessionId(sessionIdRaw)) {
    throw new HttpsError("invalid-argument", "A valid sessionId is required");
  }

  const typedAction = actionRaw as BillingAction;
  const sessionId = sessionIdRaw;
  const contents = buildPromptForAction(typedAction, {
    prompt: typeof rawData.prompt === "string" ? rawData.prompt : undefined,
    svgCode: typeof rawData.svgCode === "string" ? rawData.svgCode : undefined,
    critique: typeof rawData.critique === "string" ? rawData.critique : undefined,
    plan: typeof rawData.plan === "string" ? rawData.plan : undefined,
    iteration: typeof rawData.iteration === "number" ? rawData.iteration : undefined,
    imageBase64: typeof rawData.imageBase64 === "string" ? rawData.imageBase64 : undefined,
  });

  const ai = getGeminiClient();
  const countResult = await ai.models.countTokens({
    model: MODEL,
    contents,
  });
  const estimatedInputTokens = countResult.totalTokens || 0;
  assertInputTokenCap(estimatedInputTokens);
  const pairEstimate = estimatePairForAction(typedAction, estimatedInputTokens);

  return {
    typedAction,
    sessionId,
    contents,
    ai,
    estimatedInputTokens,
    pairEstimate,
  };
};

const computeProvisionalReserve = async (
  uid: string,
  sessionId: string,
  typedAction: BillingAction,
  pairEstimate: ReturnType<typeof estimatePairForAction>
): Promise<ReservationResult> => {
  let provisionalReserveTarget = 0;

  if (isChargeAction(typedAction)) {
    provisionalReserveTarget = creditsForGifOutput(pairEstimate.pairUsd);
  } else {
    const sessionSnap = await getSessionRef(uid, sessionId).get();
    const sessionData = sessionSnap.data() || {};
    const pendingState = readRequiredPendingPairState(typedAction, sessionData);
    provisionalReserveTarget = creditsForGifOutput(pendingState.pendingCostUsd + pairEstimate.pairUsd);
  }

  return reserveCreditsForAction(
    uid,
    sessionId,
    typedAction,
    provisionalReserveTarget
  );
};

const finalizeBillingAndPersist = async (
  uid: string,
  sessionId: string,
  typedAction: BillingAction,
  usageMetrics: UsageMetrics
): Promise<BillingSettlementResult> => {
  const settlement = await settleActionBilling(uid, sessionId, typedAction, usageMetrics);
  const userRef = db.collection("users").doc(uid);
  const sessionRef = getSessionRef(uid, sessionId);

  await Promise.all([
    userRef.set(
      {
        totalTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.totalTokens),
        totalInputTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.inputTokens),
        totalOutputTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.outputTokens),
        totalThoughtTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.thoughtTokens),
        lastActionCostUsd: usageMetrics.totalUsd,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
    sessionRef.set(
      {
        lastCompletedAction: typedAction,
        totalTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.totalTokens),
        totalInputTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.inputTokens),
        totalOutputTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.outputTokens),
        totalThoughtTokenUsage: admin.firestore.FieldValue.increment(usageMetrics.thoughtTokens),
        lastActionCostUsd: usageMetrics.totalUsd,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ]).catch((persistError) => {
    console.error("Failed to persist usage analytics after billing settlement:", {
      uid,
      action: typedAction,
      sessionId,
      persistError,
    });
  });

  return settlement;
};

const rollbackFailedReservation = async (
  uid: string,
  sessionId: string,
  typedAction: BillingAction,
  reservation: ReservationResult | null,
  error: unknown
): Promise<void> => {
  if (!reservation) return;

  try {
    await settleActionBilling(
      uid,
      sessionId,
      typedAction,
      ZERO_USAGE_METRICS,
      {
        rollbackOnly: true,
        provisionalChargedCredits: reservation.provisionalChargedCredits,
        failureReason: error instanceof HttpsError
          ? error.message
          : ((error as { message?: string } | null | undefined)?.message || "generation_failed"),
      }
    );
  } catch (rollbackError) {
    console.error("Failed to rollback reserved credits after generation failure:", {
      uid,
      action: typedAction,
      sessionId,
      provisionalChargedCredits: reservation.provisionalChargedCredits,
      rollbackError,
    });
  }
};

export const generateWithTokens = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 600 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }
    const uid = request.auth.uid;
    const data = (request.data || {}) as Record<string, unknown>;
    const { typedAction, sessionId, contents, ai, pairEstimate } = await validateAndBuildContents(data);
    const reservation = await computeProvisionalReserve(uid, sessionId, typedAction, pairEstimate);

    try {
      // Call Gemini API
      const result = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: {
          thinkingConfig: { includeThoughts: true },
        },
      });

      const text = result.text || "";
      const thoughts = result.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.thought && p.text)
        .map((p: any) => p.text)
        .join("") || null;

      // Track actual token usage for analytics/cost monitoring.
      const usage = result.usageMetadata;
      const inputTokens = usage?.promptTokenCount || 0;
      const outputTokens = usage?.candidatesTokenCount || 0;
      const thoughtTokens = usage?.thoughtsTokenCount || 0;
      const totalUsed = usage?.totalTokenCount || (inputTokens + outputTokens + thoughtTokens);
      const usageMetrics: UsageMetrics = {
        inputTokens,
        outputTokens,
        thoughtTokens,
        totalTokens: totalUsed,
        totalUsd: actionUsageCostUsd({ inputTokens, outputTokens, thoughtTokens }),
      };
      const settlement = await finalizeBillingAndPersist(uid, sessionId, typedAction, usageMetrics);

      return {
        text,
        thoughts,
        tokensUsed: totalUsed,
        remainingBalance: settlement.remainingBalance,
        chargedCreditsThisAction: roundCredits(
          reservation.provisionalChargedCredits + settlement.additionalChargedCredits
        ),
        additionalChargedCredits: settlement.additionalChargedCredits,
        finalGifCreditsForPair: settlement.pairCreditsCharged,
        rawGifCreditsForPair: settlement.pairRawCredits,
        displayGifCreditsForPair: settlement.pairDisplayCredits,
        billingDisplayWholeCredits: true,
        creditPrecisionDecimals: CREDIT_DECIMALS,
        billingRoundedToWholeCredits: false,
      };
    } catch (error) {
      await rollbackFailedReservation(uid, sessionId, typedAction, reservation, error);
      if (error instanceof HttpsError) {
        throw error;
      }
      console.error("Generation failed:", {
        uid,
        action: typedAction,
        sessionId,
        provisionalChargedCredits: reservation.provisionalChargedCredits,
        error,
      });
      throw new HttpsError("internal", "Generation failed");
    }
  }
);

// ===== STREAMING GENERATION WITH GIF CREDITS =====

export const streamGenerateWithTokens = onRequest(
  { timeoutSeconds: 600 },
  async (req, res) => {
    setCorsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    let streamStarted = false;
    let heartbeat: NodeJS.Timeout | null = null;
    let provisionalChargedCredits = 0;
    let uidForLog: string | null = null;
    let actionForLog: BillingAction | null = null;
    let sessionIdForLog: string | null = null;
    let reservationForRollback: ReservationResult | null = null;

    try {
      await verifyAppCheckFromRequest(req);
      const uid = await requireAuthenticatedUidFromRequest(req);
      uidForLog = uid;

      const body = parseCallableBody(req.body);
      const {
        typedAction,
        sessionId,
        contents,
        ai,
        pairEstimate,
        estimatedInputTokens,
      } = await validateAndBuildContents(body);
      actionForLog = typedAction;
      sessionIdForLog = sessionId;

      const reservation = await computeProvisionalReserve(uid, sessionId, typedAction, pairEstimate);
      reservationForRollback = reservation;
      provisionalChargedCredits = reservation.provisionalChargedCredits;

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
      }
      streamStarted = true;

      writeSseEvent(res, "status", {
        stage: "reserved",
        provisionalChargedCredits: reservation.provisionalChargedCredits,
        remainingBalance: reservation.remainingBalance,
      });

      heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          res.write(`: ping ${Date.now()}\n\n`);
        }
      }, 15_000);

      try {
        const stream = await ai.models.generateContentStream({
          model: MODEL,
          contents,
          config: {
            thinkingConfig: { includeThoughts: true },
          },
        });

        let text = "";
        let thoughts = "";
        let usageMetadata: any = null;

        writeSseEvent(res, "status", { stage: "generating" });

        for await (const chunk of stream) {
          const parts = chunk.candidates?.[0]?.content?.parts;
          if (!parts) continue;

          for (const part of parts) {
            if (part.thought && part.text) {
              thoughts += part.text;
              writeSseEvent(res, "thought", { chunk: part.text });
            } else if (part.text) {
              text += part.text;
              writeSseEvent(res, "output", { chunk: part.text });
            }
          }

          if (chunk.usageMetadata) {
            usageMetadata = chunk.usageMetadata;
          }
        }

        const usageInputTokens = usageMetadata?.promptTokenCount || 0;
        const usageOutputTokens = usageMetadata?.candidatesTokenCount || 0;
        const usageThoughtTokens = usageMetadata?.thoughtsTokenCount || 0;
        const usageTotalTokens = usageMetadata?.totalTokenCount || 0;
        const hasUsageMetadata = usageInputTokens > 0 || usageOutputTokens > 0 || usageThoughtTokens > 0 || usageTotalTokens > 0;

        const inputTokens = hasUsageMetadata ? usageInputTokens : estimatedInputTokens;
        const outputTokens = hasUsageMetadata
          ? usageOutputTokens
          : (OUTPUT_ESTIMATES[typedAction] || 0);
        const thoughtTokens = hasUsageMetadata ? usageThoughtTokens : 0;
        const totalUsed = hasUsageMetadata
          ? (usageTotalTokens || (inputTokens + outputTokens + thoughtTokens))
          : (inputTokens + outputTokens + thoughtTokens);
        const usageMetrics: UsageMetrics = {
          inputTokens,
          outputTokens,
          thoughtTokens,
          totalTokens: totalUsed,
          totalUsd: actionUsageCostUsd({ inputTokens, outputTokens, thoughtTokens }),
        };

        const settlement = await finalizeBillingAndPersist(uid, sessionId, typedAction, usageMetrics);

        writeSseEvent(res, "complete", {
          text,
          thoughts: thoughts || null,
          tokensUsed: totalUsed,
          remainingBalance: settlement.remainingBalance,
          chargedCreditsThisAction: roundCredits(
            reservation.provisionalChargedCredits + settlement.additionalChargedCredits
          ),
          additionalChargedCredits: settlement.additionalChargedCredits,
          finalGifCreditsForPair: settlement.pairCreditsCharged,
          rawGifCreditsForPair: settlement.pairRawCredits,
          displayGifCreditsForPair: settlement.pairDisplayCredits,
          billingDisplayWholeCredits: true,
          creditPrecisionDecimals: CREDIT_DECIMALS,
          usageEstimatedFallback: !hasUsageMetadata,
          billingRoundedToWholeCredits: false,
        });
        res.end();
      } catch (error) {
        await rollbackFailedReservation(uid, sessionId, typedAction, reservationForRollback, error);
        reservationForRollback = null;
        throw error;
      }
    } catch (error: any) {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }

      if (reservationForRollback && uidForLog && actionForLog && sessionIdForLog) {
        await rollbackFailedReservation(uidForLog, sessionIdForLog, actionForLog, reservationForRollback, error);
        reservationForRollback = null;
      }

      const safeMessage = error instanceof HttpsError
        ? error.message
        : (error?.message || "Generation failed");

      if (streamStarted && !res.writableEnded) {
        writeSseEvent(res, "error", { message: safeMessage });
        res.end();
        return;
      }

      const httpCode =
        error instanceof HttpsError
          ? (error.code === "unauthenticated"
            ? 401
            : error.code === "resource-exhausted"
              ? 429
              : error.code === "permission-denied"
                ? 403
                : error.code === "invalid-argument"
                  ? 400
                  : 500)
          : 500;

      console.error("Streaming generation failed:", {
        uid: uidForLog,
        action: actionForLog,
        sessionId: sessionIdForLog,
        provisionalChargedCredits,
        error,
      });
      res.status(httpCode).json({ error: safeMessage });
      return;
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }
);

// ===== PROMPT BUILDERS =====

type PromptPart = {
  inlineData?: {
    mimeType: string;
    data: string;
  };
  text?: string;
};

type PromptContents = string | { parts: PromptPart[] };

const sanitizePromptInput = (value: string | undefined, maxLength = 12_000): string => {
  if (!value) return "";

  const withoutControlChars = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n/g, "\n");
  const withoutDirectiveLines = withoutControlChars
    .split("\n")
    .filter((line) => !/^\s*(system|assistant|developer|instruction)\s*:/i.test(line))
    .join("\n");

  return withoutDirectiveLines
    .replace(/<\s*\/?\s*(system|assistant|developer|instruction)[^>]*>/gi, "")
    .replace(/```/g, "'''")
    .trim()
    .slice(0, maxLength);
};

function buildPromptForAction(
  action: string,
  params: {
    prompt?: string;
    svgCode?: string;
    critique?: string;
    plan?: string;
    iteration?: number;
    imageBase64?: string;
  }
): PromptContents {
  switch (action) {
    case "plan":
      return `You are an expert SVG artist and planner.
      The user has provided an ambiguous prompt: "${params.prompt}".

      1. Analyze the intent and potential artistic directions.
      2. Create a detailed technical plan for an SVG that embodies this concept.
      3. Focus on composition, color palette, and shapes.
      4. Keep the SVG complexity manageable but visually striking.
      5. Consider whether CSS keyframe animations would enhance the concept.

      Output the plan as a concise paragraph.`;

    case "generate":
      return `Create a single SVG file based on this plan: "${params.plan}".

      Requirements:
      - Use standard SVG syntax.
      - Ensure it is scalable (viewBox).
      - Use vibrant colors and clean paths.
      - Do not use external CSS files or JavaScript. Inline styles are fine.
      - If the plan calls for animation or motion, use CSS keyframe animations inside a <defs><style> block.
      - For animations, set appropriate transform-origin values and use smooth easing functions (ease-in-out).
      - For animations, only animate SVG-safe properties (transform, opacity, fill, stroke).
      - Return ONLY the SVG code.`;

    case "evaluate": {
      if (!params.imageBase64) {
        throw new HttpsError("invalid-argument", "imageBase64 required for evaluate");
      }
      const base64Data = params.imageBase64.replace(/^data:image\/[^;]+;base64,/i, "").trim();
      return {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Data,
            },
          },
          {
            text: `You are a strict Senior Design Critic.
                Analyze this rendered SVG (Iteration #${params.iteration}).
                The original goal was: "${params.prompt}".

                Critique the image based on:
                1. Alignment with the prompt.
                2. Visual aesthetics (balance, color, contrast).
                3. Technical execution (if visible artifacts exist).
                4. Animation quality (if present).

                Be harsh but constructive. Point out exactly what looks wrong.
                Limit your critique to 3-4 concise, actionable bullet points.`,
          },
        ],
      };
    }

    case "refine": {
      const sanitizedPrompt = sanitizePromptInput(params.prompt, 2_000);
      const sanitizedSvgCode = sanitizePromptInput(params.svgCode, 30_000);
      const sanitizedCritique = sanitizePromptInput(params.critique, 5_000);

      return `You are an expert SVG Coder.

      Original Goal: "${sanitizedPrompt}"

      Current SVG Code:
      \`\`\`xml
      ${sanitizedSvgCode}
      \`\`\`

      Critique to address:
      ${sanitizedCritique}

      Task:
      Rewrite the SVG code to fix the issues mentioned in the critique and improve the overall quality.
      - Keep the code clean and efficient.
      - Ensure valid XML.
      - If the current SVG uses CSS keyframe animations, preserve and improve them.
      - Do not use external CSS files or JavaScript.
      - Return ONLY the new SVG code.`;
    }

    default:
      throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
  }
}

// ===== ACCOUNT DELETION =====

export const deleteMyAccount = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const uid = request.auth.uid;
    try {
      // Delete Firebase Auth account first to avoid partial account removal on auth failure.
      await admin.auth().deleteUser(uid);

      // Delete user-owned purchase records in batches.
      while (true) {
        const purchasesSnap = await db
          .collection("purchases")
          .where("uid", "==", uid)
          .limit(200)
          .get();

        if (purchasesSnap.empty) break;

        const batch = db.batch();
        purchasesSnap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      // Delete user-owned generation session records in batches.
      while (true) {
        const sessionsSnap = await db
          .collection("generationSessions")
          .where("uid", "==", uid)
          .limit(200)
          .get();

        if (sessionsSnap.empty) break;

        const batch = db.batch();
        sessionsSnap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      // Delete user balance/profile doc.
      await db.collection("users").doc(uid).delete();

      return { deleted: true };
    } catch (error) {
      console.error("deleteMyAccount failed:", { uid, error });
      throw new HttpsError("internal", "Account deletion failed. Please retry.");
    }
  }
);

import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export interface TokenEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotal: number;
}

export interface GenerateResult {
  text: string;
  thoughts: string | null;
  tokensUsed: number;
  remainingBalance: number;
}

export interface BalanceResult {
  balance: number;
}

export interface PurchaseVerifyResult {
  alreadyCredited: boolean;
  balance: number;
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

const GENERATE_WITH_TOKENS_TIMEOUT_MS = 8 * 60 * 1000;

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
  const payload: GenerateWithTokensRequest = { action, ...params };
  const result = await fn(payload);
  return result.data;
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

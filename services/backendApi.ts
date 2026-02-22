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
  const fn = httpsCallable<any, TokenEstimate>(functions, "estimateTokenCost");
  const result = await fn({ action, ...params });
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
  const fn = httpsCallable<any, GenerateResult>(functions, "generateWithTokens");
  const result = await fn({ action, ...params });
  return result.data;
};

export const getBalance = async (): Promise<number> => {
  const fn = httpsCallable<any, BalanceResult>(functions, "getBalance");
  const result = await fn({});
  return result.data.balance;
};

export const verifyPurchase = async (
  purchaseToken: string,
  productId: string
): Promise<PurchaseVerifyResult> => {
  const fn = httpsCallable<any, PurchaseVerifyResult>(functions, "verifyAndCreditPurchase");
  const result = await fn({ purchaseToken, productId });
  return result.data;
};

export const deleteMyAccount = async (): Promise<boolean> => {
  const fn = httpsCallable<any, DeleteAccountResult>(functions, "deleteMyAccount");
  const result = await fn({});
  return !!result.data.deleted;
};

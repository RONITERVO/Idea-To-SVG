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
  return Math.round(Math.max(0, value) * CREDIT_PRECISION_FACTOR) / CREDIT_PRECISION_FACTOR;
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
  const requestedReserve = roundCredits(Math.max(0, provisionalChargeEstimate));

  return db.runTransaction(async (tx) => {
    const [userDoc, sessionDoc] = await Promise.all([tx.get(userRef), tx.get(sessionRef)]);
    const currentBalance = userDoc.exists ? roundCredits(Number(userDoc.data()?.balance) || 0) : 0;
    const sessionData = sessionDoc.data() || {};
    const currentPendingGenerate = sessionDoc.exists ? (Number(sessionData.pendingGenerate) || 0) : 0;
    const currentPendingRefine = sessionDoc.exists ? (Number(sessionData.pendingRefine) || 0) : 0;
    const currentPlanReservedCredits = roundCredits(Number(sessionData.pendingPlanReservedCredits) || 0);
    const currentEvaluateReservedCredits = roundCredits(Number(sessionData.pendingEvaluateReservedCredits) || 0);
    const provisionalCharge =
      action === "generate"
        ? ceilCredits(Math.max(0, requestedReserve - currentPlanReservedCredits))
        : action === "refine"
          ? ceilCredits(Math.max(0, requestedReserve - currentEvaluateReservedCredits))
          : requestedReserve;

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
        creditDebt: roundCredits(Math.max(0, -newBalance)),
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
      sessionUpdate.pendingPlanReservedCredits = roundCredits(currentPlanReservedCredits + provisionalCharge);
    }
    if (action === "refine") {
      sessionUpdate.pendingEvaluateReservedCredits = roundCredits(currentEvaluateReservedCredits + provisionalCharge);
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

const settleActionBilling = async (
  uid: string,
  sessionId: string,
  action: BillingAction,
  usage: UsageMetrics
): Promise<BillingSettlementResult> => {
  const userRef = db.collection("users").doc(uid);
  const sessionRef = getSessionRef(uid, sessionId);

  return db.runTransaction(async (tx) => {
    const [userDoc, sessionDoc] = await Promise.all([tx.get(userRef), tx.get(sessionRef)]);
    const currentBalance = userDoc.exists ? roundCredits(Number(userDoc.data()?.balance) || 0) : 0;
    const sessionData = sessionDoc.data() || {};
    let newBalance = currentBalance;

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
        remainingBalance: newBalance,
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
        remainingBalance: newBalance,
        additionalChargedCredits: 0,
        pairCreditsCharged: null,
        pairRawCredits: null,
        pairDisplayCredits: null,
      };
    }

    if (action === "generate") {
      const pendingPlanCostUsd = Number(sessionData.pendingPlanCostUsd) || 0;
      const pendingPlanTokens = Number(sessionData.pendingPlanTokens) || 0;
      const reservedCredits = roundCredits(Number(sessionData.pendingPlanReservedCredits) || 0);

      const pairCostUsd = pendingPlanCostUsd + usage.totalUsd;
      const pairTokens = pendingPlanTokens + usage.totalTokens;
      const pairBilling = computeGifBilling(pairCostUsd);
      const pairCredits = pairBilling.billedCredits;
      const additionalCredits = ceilCredits(Math.max(0, pairCredits - reservedCredits));
      newBalance = roundCredits(currentBalance - additionalCredits);

      tx.set(
        userRef,
        {
          balance: newBalance,
          gifBalance: newBalance,
          totalConsumed: admin.firestore.FieldValue.increment(additionalCredits),
          creditDebt: roundCredits(Math.max(0, -newBalance)),
          hasNegativeBalance: newBalance < 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        sessionRef,
        {
          pendingPlanCostUsd: 0,
          pendingPlanTokens: 0,
          pendingPlanReservedCredits: 0,
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
    }

    const pendingEvaluateCostUsd = Number(sessionData.pendingEvaluateCostUsd) || 0;
    const pendingEvaluateTokens = Number(sessionData.pendingEvaluateTokens) || 0;
    const reservedCredits = roundCredits(Number(sessionData.pendingEvaluateReservedCredits) || 0);

    const pairCostUsd = pendingEvaluateCostUsd + usage.totalUsd;
    const pairTokens = pendingEvaluateTokens + usage.totalTokens;
    const pairBilling = computeGifBilling(pairCostUsd);
    const pairCredits = pairBilling.billedCredits;
    const additionalCredits = ceilCredits(Math.max(0, pairCredits - reservedCredits));
    newBalance = roundCredits(currentBalance - additionalCredits);

    tx.set(
      userRef,
      {
        balance: newBalance,
        gifBalance: newBalance,
        totalConsumed: admin.firestore.FieldValue.increment(additionalCredits),
        creditDebt: roundCredits(Math.max(0, -newBalance)),
        hasNegativeBalance: newBalance < 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      sessionRef,
      {
        pendingEvaluateCostUsd: 0,
        pendingEvaluateTokens: 0,
        pendingEvaluateReservedCredits: 0,
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
            creditDebt: roundCredits(Math.max(0, -newBal)),
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

export const generateWithTokens = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 600 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }
    const uid = request.auth.uid;
    const { action, prompt, svgCode, critique, plan, imageBase64, iteration, sessionId } = request.data;

    if (typeof action !== "string" || !BILLING_ACTIONS.includes(action as BillingAction)) {
      throw new HttpsError("invalid-argument", "Invalid action");
    }
    if (!isValidSessionId(sessionId)) {
      throw new HttpsError("invalid-argument", "A valid sessionId is required");
    }
    const typedAction = action as BillingAction;

    const contents = buildPromptForAction(typedAction, {
      prompt,
      svgCode,
      critique,
      plan,
      iteration,
      imageBase64,
    });

    const ai = getGeminiClient();
    const countResult = await ai.models.countTokens({
      model: MODEL,
      contents,
    });
    const estimatedInputTokens = countResult.totalTokens || 0;
    assertInputTokenCap(estimatedInputTokens);

    const pairEstimate = estimatePairForAction(typedAction, estimatedInputTokens);
    let provisionalReserveTarget = 0;
    if (isChargeAction(typedAction)) {
      provisionalReserveTarget = creditsForGifOutput(pairEstimate.pairUsd);
    } else {
      const sessionSnap = await getSessionRef(uid, sessionId).get();
      const sessionData = sessionSnap.data() || {};
      const pendingPairUsd = typedAction === "generate"
        ? Number(sessionData.pendingPlanCostUsd) || 0
        : Number(sessionData.pendingEvaluateCostUsd) || 0;
      provisionalReserveTarget = creditsForGifOutput(pendingPairUsd + pairEstimate.pairUsd);
    }

    const reservation = await reserveCreditsForAction(
      uid,
      sessionId,
      typedAction,
      provisionalReserveTarget
    );

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

      const userRef = db.collection("users").doc(uid);
      const sessionRef = getSessionRef(uid, sessionId);
      const settlement = await settleActionBilling(uid, sessionId, typedAction, usageMetrics);

      await Promise.all([
        userRef.set(
          {
            totalTokenUsage: admin.firestore.FieldValue.increment(totalUsed),
            totalInputTokenUsage: admin.firestore.FieldValue.increment(inputTokens),
            totalOutputTokenUsage: admin.firestore.FieldValue.increment(outputTokens),
            totalThoughtTokenUsage: admin.firestore.FieldValue.increment(thoughtTokens),
            lastActionCostUsd: usageMetrics.totalUsd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
        sessionRef.set(
          {
            lastCompletedAction: typedAction,
            totalTokenUsage: admin.firestore.FieldValue.increment(totalUsed),
            totalInputTokenUsage: admin.firestore.FieldValue.increment(inputTokens),
            totalOutputTokenUsage: admin.firestore.FieldValue.increment(outputTokens),
            totalThoughtTokenUsage: admin.firestore.FieldValue.increment(thoughtTokens),
            lastActionCostUsd: usageMetrics.totalUsd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
      ]);

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

    try {
      await verifyAppCheckFromRequest(req);
      const uid = await requireAuthenticatedUidFromRequest(req);
      uidForLog = uid;

      const body = parseCallableBody(req.body);
      const actionRaw = body.action;
      const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
      const svgCode = typeof body.svgCode === "string" ? body.svgCode : undefined;
      const critique = typeof body.critique === "string" ? body.critique : undefined;
      const plan = typeof body.plan === "string" ? body.plan : undefined;
      const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : undefined;
      const iteration = typeof body.iteration === "number" ? body.iteration : undefined;
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";

      if (typeof actionRaw !== "string" || !BILLING_ACTIONS.includes(actionRaw as BillingAction)) {
        throw new HttpsError("invalid-argument", "Invalid action");
      }
      if (!isValidSessionId(sessionId)) {
        throw new HttpsError("invalid-argument", "A valid sessionId is required");
      }

      const typedAction = actionRaw as BillingAction;
      actionForLog = typedAction;
      sessionIdForLog = sessionId;

      const contents = buildPromptForAction(typedAction, {
        prompt,
        svgCode,
        critique,
        plan,
        iteration,
        imageBase64,
      });

      const ai = getGeminiClient();
      const countResult = await ai.models.countTokens({
        model: MODEL,
        contents,
      });
      const estimatedInputTokens = countResult.totalTokens || 0;
      assertInputTokenCap(estimatedInputTokens);

      const pairEstimate = estimatePairForAction(typedAction, estimatedInputTokens);
      let provisionalReserveTarget = 0;
      if (isChargeAction(typedAction)) {
        provisionalReserveTarget = creditsForGifOutput(pairEstimate.pairUsd);
      } else {
        const sessionSnap = await getSessionRef(uid, sessionId).get();
        const sessionData = sessionSnap.data() || {};
        const pendingPairUsd = typedAction === "generate"
          ? Number(sessionData.pendingPlanCostUsd) || 0
          : Number(sessionData.pendingEvaluateCostUsd) || 0;
        provisionalReserveTarget = creditsForGifOutput(pendingPairUsd + pairEstimate.pairUsd);
      }

      const reservation = await reserveCreditsForAction(
        uid,
        sessionId,
        typedAction,
        provisionalReserveTarget
      );
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

      const userRef = db.collection("users").doc(uid);
      const sessionRef = getSessionRef(uid, sessionId);
      const settlement = await settleActionBilling(uid, sessionId, typedAction, usageMetrics);

      await Promise.all([
        userRef.set(
          {
            totalTokenUsage: admin.firestore.FieldValue.increment(totalUsed),
            totalInputTokenUsage: admin.firestore.FieldValue.increment(inputTokens),
            totalOutputTokenUsage: admin.firestore.FieldValue.increment(outputTokens),
            totalThoughtTokenUsage: admin.firestore.FieldValue.increment(thoughtTokens),
            lastActionCostUsd: usageMetrics.totalUsd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
        sessionRef.set(
          {
            lastCompletedAction: typedAction,
            totalTokenUsage: admin.firestore.FieldValue.increment(totalUsed),
            totalInputTokenUsage: admin.firestore.FieldValue.increment(inputTokens),
            totalOutputTokenUsage: admin.firestore.FieldValue.increment(outputTokens),
            totalThoughtTokenUsage: admin.firestore.FieldValue.increment(thoughtTokens),
            lastActionCostUsd: usageMetrics.totalUsd,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
      ]);

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
    } catch (error: any) {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
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

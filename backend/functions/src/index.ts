import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
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

// Product ID → token amount mapping
const TOKEN_PACKS: Record<string, number> = {
  token_pack_tier1: 100_000,
  token_pack_tier2: 500_000,
  token_pack_tier3: 2_000_000,
  token_pack_tier4: 10_000_000,
};

// Estimated output tokens by action type
const OUTPUT_ESTIMATES: Record<string, number> = {
  plan: 1_000,
  generate: 3_000,
  evaluate: 500,
  refine: 3_000,
};

const MODEL = "gemini-2.5-flash";
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";

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

const getUserBalance = async (uid: string): Promise<number> => {
  const doc = await db.collection("users").doc(uid).get();
  return doc.exists ? (doc.data()?.balance || 0) : 0;
};

const consumePurchase = async (
  androidPublisher: any,
  productId: string,
  purchaseToken: string
): Promise<void> => {
  try {
    await androidPublisher.purchases.products.consume({
      packageName: "com.ronitervo.ideatesvg",
      productId,
      token: purchaseToken,
    });
  } catch (consumeError) {
    if (!isAlreadyConsumedError(consumeError)) {
      throw consumeError;
    }
  }
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

    const tokensToGrant = TOKEN_PACKS[productId];
    if (!tokensToGrant) {
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
        packageName: "com.ronitervo.ideatesvg",
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
            tokensGranted: 0,
            consumedBeforeVerification: true,
            verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return { alreadyCredited: true, balance: currentBalance };
      }

      // Credit tokens
      const userRef = db.collection("users").doc(uid);
      const newBalance = await db.runTransaction(async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentBalance = userDoc.exists ? (userDoc.data()?.balance || 0) : 0;
        const newBal = currentBalance + tokensToGrant;

        tx.set(
          userRef,
          {
            balance: newBal,
            totalPurchased: admin.firestore.FieldValue.increment(tokensToGrant),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(userDoc.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
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
          tokensGranted: tokensToGrant,
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

      return { alreadyCredited: false, balance: newBalance, tokensGranted: tokensToGrant };
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

    if (!action || !["plan", "generate", "evaluate", "refine"].includes(action)) {
      throw new HttpsError("invalid-argument", "Invalid action");
    }

    const ai = getGeminiClient();
    const contents = buildPromptForAction(action, { prompt, svgCode, critique, plan, iteration });

    const countResult = await ai.models.countTokens({
      model: MODEL,
      contents,
    });

    const inputTokens = countResult.totalTokens || 0;
    const estimatedOutput = OUTPUT_ESTIMATES[action] || 2_000;

    return {
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: estimatedOutput,
      estimatedTotal: inputTokens + estimatedOutput,
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
      // Create user doc with 0 balance
      await db.collection("users").doc(uid).set({
        balance: 0,
        totalPurchased: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { balance: 0 };
    }

    return { balance: userDoc.data()?.balance || 0 };
  }
);

// ===== GENERATE WITH TOKENS =====

export const generateWithTokens = onCall(
  { enforceAppCheck: ENFORCE_APP_CHECK, timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }
    const uid = request.auth.uid;
    const { action, prompt, svgCode, critique, plan, imageBase64, iteration } = request.data;

    if (!action || !["plan", "generate", "evaluate", "refine"].includes(action)) {
      throw new HttpsError("invalid-argument", "Invalid action");
    }

    // Check balance
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();
    const balance = userDoc.exists ? (userDoc.data()?.balance || 0) : 0;

    const estimatedOutput = OUTPUT_ESTIMATES[action] || 2_000;
    const minRequired = 1_000 + estimatedOutput; // minimum to proceed

    if (balance < minRequired) {
      throw new HttpsError(
        "resource-exhausted",
        `Insufficient tokens. Balance: ${balance}, estimated cost: ${minRequired}`
      );
    }

    const ai = getGeminiClient();
    const contents = buildPromptForAction(action, { prompt, svgCode, critique, plan, iteration, imageBase64 });

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

    // Get actual token usage
    const usage = result.usageMetadata;
    const inputTokens = usage?.promptTokenCount || 0;
    const outputTokens = usage?.candidatesTokenCount || 0;
    const totalUsed = inputTokens + outputTokens;

    // Deduct tokens
    const newBalance = await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const currentBalance = doc.exists ? (doc.data()?.balance || 0) : 0;
      if (currentBalance < totalUsed) {
        throw new HttpsError(
          "resource-exhausted",
          `Insufficient tokens after generation. Balance: ${currentBalance}, required: ${totalUsed}`
        );
      }
      const newBal = currentBalance - totalUsed;
      tx.set(
        userRef,
        {
          balance: newBal,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(doc.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
        },
        { merge: true }
      );
      return newBal;
    });

    return {
      text,
      thoughts,
      tokensUsed: totalUsed,
      remainingBalance: newBalance,
    };
  }
);

// ===== PROMPT BUILDERS =====

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
): any {
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
      const base64Data = params.imageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
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

    case "refine":
      return `You are an expert SVG Coder.

      Original Goal: "${params.prompt}"

      Current SVG Code:
      \`\`\`xml
      ${params.svgCode}
      \`\`\`

      Critique to address:
      ${params.critique}

      Task:
      Rewrite the SVG code to fix the issues mentioned in the critique and improve the overall quality.
      - Keep the code clean and efficient.
      - Ensure valid XML.
      - If the current SVG uses CSS keyframe animations, preserve and improve them.
      - Do not use external CSS files or JavaScript.
      - Return ONLY the new SVG code.`;

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

    // Delete token balance/profile doc.
    await db.collection("users").doc(uid).delete().catch(() => {});

    // Delete Firebase Auth account.
    await admin.auth().deleteUser(uid);

    return { deleted: true };
  }
);

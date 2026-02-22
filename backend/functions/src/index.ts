import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";

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

// ===== BILLING =====

export const verifyAndCreditPurchase = onCall(
  { enforceAppCheck: false },
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

    // Idempotency check: has this purchase already been credited?
    const existingPurchase = await db
      .collection("purchases")
      .where("purchaseToken", "==", purchaseToken)
      .limit(1)
      .get();

    if (!existingPurchase.empty) {
      const existing = existingPurchase.docs[0].data();
      return { alreadyCredited: true, balance: existing.balanceAfter };
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

      // Record purchase
      await db.collection("purchases").add({
        uid,
        productId,
        purchaseToken,
        tokensGranted: tokensToGrant,
        orderId: verification.data.orderId || null,
        balanceAfter: newBalance,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "completed",
      });

      // Acknowledge purchase (consume it so user can buy again)
      await androidPublisher.purchases.products.acknowledge({
        packageName: "com.ronitervo.ideatesvg",
        productId: productId,
        token: purchaseToken,
      });

      return { alreadyCredited: false, balance: newBalance, tokensGranted: tokensToGrant };
    } catch (error: any) {
      if (error instanceof HttpsError) throw error;
      console.error("Purchase verification failed:", error);
      throw new HttpsError("internal", "Failed to verify purchase");
    }
  }
);

// ===== TOKEN ESTIMATION =====

export const estimateTokenCost = onCall(
  { enforceAppCheck: false },
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
  { enforceAppCheck: false },
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
  { enforceAppCheck: false, timeoutSeconds: 300 },
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
      const newBal = Math.max(0, currentBalance - totalUsed);
      tx.update(userRef, { balance: newBal, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
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

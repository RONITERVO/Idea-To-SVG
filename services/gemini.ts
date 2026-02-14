import { GoogleGenAI, Type } from "@google/genai";
import { getApiKeyOrThrow } from './apiKeyStorage';

const MODEL_REASONING = 'gemini-3-pro-preview';
const MODEL_VISION = 'gemini-3-pro-preview'; 

// Get API key from storage or use dev fallback in development only
const getApiKey = (): string => {
  try {
    return getApiKeyOrThrow();
  } catch (e) {
    // Only allow fallback in development mode
    if (import.meta.env.DEV && import.meta.env.VITE_GEMINI_API_KEY) {
      console.warn('Using development fallback API key');
      return import.meta.env.VITE_GEMINI_API_KEY;
    }
    throw e;
  }
};

let ai: GoogleGenAI;

// Initialize the API client lazily
const getAI = (): GoogleGenAI => {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: getApiKey() });
  }
  return ai;
};

// Reset the API client (useful when API key changes)
export const resetAI = (): void => {
  ai = null as any;
};

const cleanSVGCode = (text: string): string => {
  let clean = text;

  // 1. Remove Markdown blocks (handle standard and malformed blocks)
  const markdownRegex = /```(?:xml|svg|html|jsx|tsx|javascript|typescript)?\s*([\s\S]*?)\s*```/i;
  const match = clean.match(markdownRegex);
  if (match && match[1]) {
    clean = match[1].trim();
  }

  // 2. Decode HTML entities (in case of copy-paste from rendered HTML)
  clean = clean.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  // 3. Extract SVG Tag (Strict Mode)
  // We look for the first <svg ...> and the last matching </svg>, or a self-closing />
  const svgStartRegex = /<svg[\s\S]*?>/i;
  const startMatch = clean.match(svgStartRegex);

  if (startMatch) {
    const startIndex = startMatch.index!;
    const startTag = startMatch[0];
    
    // Check if the start tag itself is self-closing (e.g., <svg ... />)
    if (startTag.trim().endsWith('/>')) {
       clean = startTag;
    } else {
       // Look for the closing tag starting from the match
       const remainder = clean.substring(startIndex);
       const svgEndRegex = /<\/\s*svg>/i;
       const endMatch = remainder.match(svgEndRegex);
       
       if (endMatch) {
          const endIndex = endMatch.index! + endMatch[0].length;
          clean = remainder.substring(0, endIndex);
       } else {
          // If no closing tag found, we assume the content is the SVG but might be truncated or malformed.
          // We take the remainder as a best effort.
          clean = remainder;
       }
    }
  }

  // 4. Aggressive React/JS Artifact Cleaning
  // Even if extraction worked, sometimes artifacts remain inside or around if regex matched weirdly.
  clean = clean.replace(/export\s+default\s+function\s*[\w]*\s*\([\s\S]*?\)\s*\{/gi, '');
  clean = clean.replace(/export\s+default\s+\([\s\S]*?\)\s*=>\s*\(?/gi, '');
  clean = clean.replace(/const\s+[\w]+\s*=\s*\([\s\S]*?\)\s*=>\s*\(?/gi, '');
  clean = clean.replace(/^[\s\S]*?=>\s*\(\s*/, ''); // Removes artifact like "> = (props) => ("
  clean = clean.replace(/^[\s\S]*?return\s*\(\s*/, ''); 
  
  // 5. Clean React-specific Props
  clean = clean.replace(/\{\s*\.\.\.\s*props\s*\}/gi, '');
  clean = clean.replace(/\sclassName=/g, ' class=');
  clean = clean.replace(/\shtmlFor=/g, ' for=');
  clean = clean.replace(/\sref=\{[^}]+\}/g, '');
  clean = clean.replace(/\skey=\{[^}]+\}/g, '');

  // 6. Convert CamelCase Attributes -> SVG Kebab-Case
  const replacements: [RegExp, string][] = [
    [/\sstrokeWidth=/g, ' stroke-width='],
    [/\sstrokeLinecap=/g, ' stroke-linecap='],
    [/\sstrokeLinejoin=/g, ' stroke-linejoin='],
    [/\sstrokeMiterlimit=/g, ' stroke-miterlimit='],
    [/\sstrokeDasharray=/g, ' stroke-dasharray='],
    [/\sstrokeDashoffset=/g, ' stroke-dashoffset='],
    [/\sstrokeOpacity=/g, ' stroke-opacity='],
    [/\sfillOpacity=/g, ' fill-opacity='],
    [/\sfillRule=/g, ' fill-rule='],
    [/\sclipPath=/g, ' clip-path='],
    [/\sclipRule=/g, ' clip-rule='],
    [/\sstopColor=/g, ' stop-color='],
    [/\sstopOpacity=/g, ' stop-opacity='],
    [/\sfloodColor=/g, ' flood-color='],
    [/\sfloodOpacity=/g, ' flood-opacity='],
    [/\slightingColor=/g, ' lighting-color='],
    [/\stextAnchor=/g, ' text-anchor='],
    [/\sdominantBaseline=/g, ' dominant-baseline='],
    [/\salignmentBaseline=/g, ' alignment-baseline='],
    [/\spointerEvents=/g, ' pointer-events='],
    [/\svectorEffect=/g, ' vector-effect='],
  ];

  replacements.forEach(([regex, replacement]) => {
    clean = clean.replace(regex, replacement);
  });

  // Standardize viewBox to camelCase (SVG standard)
  clean = clean.replace(/\sviewbox=/g, ' viewBox=');

  return clean.trim();
};

const retryOperation = async <T>(operation: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
  try {
    return await operation();
  } catch (error: any) {
    if (retries <= 0) throw error;
    console.warn(`API call failed, retrying in ${delay}ms...`, error);
    await new Promise(res => setTimeout(res, delay));
    return retryOperation(operation, retries - 1, delay * 2);
  }
};

export const planSVG = async (userPrompt: string): Promise<string> => {
  return retryOperation(async () => {
    const response = await getAI().models.generateContent({
      model: MODEL_REASONING,
      contents: `You are an expert SVG artist and planner. 
      The user has provided an ambiguous prompt: "${userPrompt}".
      
      1. Analyze the intent and potential artistic directions.
      2. Create a detailed technical plan for an SVG that embodies this concept. 
      3. Focus on composition, color palette, and shapes.
      4. Keep the SVG complexity manageable but visually striking.
      
      Output the plan as a concise paragraph.`,
      config: {
        thinkingConfig: { thinkingBudget: 1024 }
      }
    });
    return response.text || "Failed to generate plan.";
  });
};

export const generateInitialSVG = async (plan: string): Promise<string> => {
  return retryOperation(async () => {
    const response = await getAI().models.generateContent({
      model: MODEL_REASONING,
      contents: `Create a single SVG file based on this plan: "${plan}".
      
      Requirements:
      - Use standard SVG syntax.
      - Ensure it is scalable (viewBox).
      - Use vibrant colors and clean paths.
      - Do not use external CSS or scripts.
      - Return ONLY the SVG code.`,
      config: {
        thinkingConfig: { thinkingBudget: 2048 }
      }
    });
    return cleanSVGCode(response.text || "");
  });
};

export const evaluateSVG = async (imageBase64: string, originalPrompt: string, iteration: number): Promise<string> => {
  return retryOperation(async () => {
    const base64Data = imageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

    const response = await getAI().models.generateContent({
      model: MODEL_VISION,
      contents: {
        parts: [
            {
                inlineData: {
                    mimeType: 'image/png',
                    data: base64Data
                }
            },
            {
                text: `You are a strict Senior Design Critic. 
                Analyze this rendered SVG (Iteration #${iteration}).
                The original goal was: "${originalPrompt}".
                
                Critique the image based on:
                1. Alignment with the prompt.
                2. Visual aesthetics (balance, color, contrast).
                3. Technical execution (if visible artifacts exist).
                
                Be harsh but constructive. Point out exactly what looks wrong, amateurish, or broken.
                Limit your critique to 3-4 concise, actionable bullet points.`
            }
        ]
      },
      config: {
         thinkingConfig: { thinkingBudget: 1024 }
      }
    });
    return response.text || "No critique generated.";
  });
};

export const refineSVG = async (currentSvgCode: string, critique: string, originalPrompt: string): Promise<string> => {
  return retryOperation(async () => {
    const response = await getAI().models.generateContent({
      model: MODEL_REASONING,
      contents: `You are an expert SVG Coder.
      
      Original Goal: "${originalPrompt}"
      
      Current SVG Code:
      \`\`\`xml
      ${currentSvgCode}
      \`\`\`
      
      Critique to address:
      ${critique}
      
      Task:
      Rewrite the SVG code to fix the issues mentioned in the critique and improve the overall quality.
      - Keep the code clean and efficient.
      - Ensure valid XML.
      - Return ONLY the new SVG code.`,
      config: {
        thinkingConfig: { thinkingBudget: 4096 }
      }
    });
    return cleanSVGCode(response.text || "");
  });
};
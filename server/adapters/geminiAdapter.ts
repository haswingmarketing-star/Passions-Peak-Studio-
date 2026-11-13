import { GoogleGenAI, type Part } from "@google/genai";

export interface GeminiTextResult<T> {
  data: T;
  totalTokens: number;
  model: string;
}

export interface GeminiImageResult {
  base64Data: string;
  mimeType: string;
  model: string;
}

export interface LyriaMusicResult {
  audioBuffer: Buffer;
  mimeType: string;
  lyrics: string;
  model: string;
}

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "YOUR_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY is not configured in runtime secrets.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  const delays = [1000, 3000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const nonRetryable = msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED");
      if (nonRetryable || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delays[attempt] ?? 3000));
    }
  }
  throw lastError;
}

export const geminiAdapter = {
  isConfigured(): boolean {
    const k = process.env.GEMINI_API_KEY;
    return Boolean(k && k !== "MY_GEMINI_API_KEY" && k !== "YOUR_GEMINI_API_KEY");
  },

  async generateJson<T>(params: {
    systemInstruction: string;
    prompt: string;
    model?: string;
    validate?: (parsed: unknown) => T;
  }): Promise<GeminiTextResult<T>> {
    const model = params.model ?? "gemini-3.1-flash-lite";
    const ai = getClient();

    const invoke = async (userPrompt: string) =>
      withRetry(async () => {
        const response = await ai.models.generateContent({
          model,
          contents: userPrompt,
          config: {
            systemInstruction: params.systemInstruction,
            responseMimeType: "application/json",
          },
        });
        const text = (response.text ?? "").trim();
        const tokens = response.usageMetadata?.totalTokenCount ?? Math.ceil((userPrompt.length + text.length) / 4);
        return { text, tokens };
      });

    let firstAttempt = await invoke(params.prompt);
    try {
      const cleaned = firstAttempt.text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const data = params.validate ? params.validate(parsed) : (parsed as T);
      return { data, totalTokens: firstAttempt.tokens, model };
    } catch (firstErr) {
      // Repair retry once per specification
      const repairPrompt = `Your previous JSON output failed validation with error: ${
        firstErr instanceof Error ? firstErr.message : String(firstErr)
      }.\n\nMalformed output:\n${firstAttempt.text.slice(0, 6000)}\n\nFix the JSON so it strictly satisfies the schema and return valid JSON only.`;
      const repaired = await invoke(repairPrompt);
      const cleaned2 = repaired.text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed2 = JSON.parse(cleaned2);
      const data2 = params.validate ? params.validate(parsed2) : (parsed2 as T);
      return { data: data2, totalTokens: firstAttempt.tokens + repaired.tokens, model };
    }
  },

  async generateImage(params: {
    prompt: string;
    aspectRatio: "9:16" | "16:9" | "1:1" | "3:4" | "4:3";
    referenceImages?: Array<{ mimeType: string; data: string; label?: string }>;
    model?: string;
  }): Promise<GeminiImageResult> {
    const model = params.model ?? "gemini-3.1-flash-lite-image";
    const ai = getClient();

    const parts: Part[] = [];
    if (params.referenceImages && params.referenceImages.length > 0) {
      for (const ref of params.referenceImages) {
        parts.push({
          inlineData: {
            mimeType: ref.mimeType,
            data: ref.data,
          },
        });
      }
    }
    parts.push({ text: params.prompt });

    return withRetry(async () => {
      const response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          imageConfig: {
            aspectRatio: params.aspectRatio,
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          return {
            base64Data: part.inlineData.data,
            mimeType: part.inlineData.mimeType ?? "image/png",
            model,
          };
        }
      }
      throw new Error("Gemini image model returned no image bytes.");
    });
  },

  async generateLyriaMusic(params: {
    prompt: string;
    pro?: boolean;
  }): Promise<LyriaMusicResult> {
    const model = params.pro ? "lyria-3-pro-preview" : "lyria-3-clip-preview";
    const ai = getClient();

    return withRetry(async () => {
      const responseStream = await ai.models.generateContentStream({
        model,
        contents: params.prompt,
      });

      const chunks: Buffer[] = [];
      let lyrics = "";
      let mimeType = "audio/mpeg";

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (chunks.length === 0 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            chunks.push(Buffer.from(part.inlineData.data, "base64"));
          }
          if (part.text) {
            lyrics += part.text;
          }
        }
      }

      if (chunks.length === 0) {
        throw new Error(`Lyria (${model}) returned no audio chunks.`);
      }
      return {
        audioBuffer: Buffer.concat(chunks),
        mimeType,
        lyrics,
        model,
      };
    });
  },

  async transcribeAudioToSrt(params: {
    base64Audio: string;
    mimeType: string;
    durationHintSec?: number;
  }): Promise<string> {
    const ai = getClient();
    return withRetry(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.base64Audio,
              },
            },
            {
              text: `Transcribe this spoken dialogue/voiceover into valid SRT subtitle format with accurate timestamps${
                params.durationHintSec ? ` (total length ~${params.durationHintSec}s)` : ""
              }. Return SRT text only.`,
            },
          ],
        },
      });
      return (response.text ?? "").trim();
    });
  },
};

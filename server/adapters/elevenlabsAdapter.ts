export interface ElevenLabsSuccess {
  ok: true;
  audioBuffer: Buffer;
  mimeType: string;
  charsUsed: number;
  voiceId: string;
}

export interface ElevenLabsFallback {
  ok: false;
  reason: "MISSING_KEY" | "UNAUTHORIZED" | "RATE_LIMIT" | "API_ERROR";
  message: string;
}

export type ElevenLabsResult = ElevenLabsSuccess | ElevenLabsFallback;

export const ELEVENLABS_VOICE_PRESETS = [
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella — Poised, Dramatic Female" },
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel — Warm, Intelligent Female" },
  { id: "MF3mGyEYCl7XYWbV9V6O", label: "Elli — Youthful, Driven Female" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi — Assertive, Sharp Female" },
  { id: "ErXwobaYiN019PkySvjV", label: "Antoni — Smooth, Commanding Male" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold — Deep, Calculating Male" },
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh — Energetic, Conversational Male" },
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam — Measured, Steady Male" },
  { id: "yoZ06aMxZJJ28mfd3POQ", label: "Sam — Warm, Reflective Male" },
  { id: "ODq5zmih8GrVes37Dizd", label: "Patrick — Bold, Expressive Male" },
];

export const elevenlabsAdapter = {
  isConfigured(): boolean {
    const key = process.env.ELEVENLABS_API_KEY;
    return Boolean(key && key.trim().length > 8);
  },

  async synthesize(params: {
    text: string;
    voiceId?: string;
    stability?: number;
    similarityBoost?: number;
  }): Promise<ElevenLabsResult> {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) {
      return {
        ok: false,
        reason: "MISSING_KEY",
        message: "ELEVENLABS_API_KEY is not set in server secrets. Using Edge-TTS / local fallback.",
      };
    }

    const voiceId = params.voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    const delays = [1000, 3000];

    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: params.text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: params.stability ?? 0.48,
              similarity_boost: params.similarityBoost ?? 0.78,
            },
          }),
        });

        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            reason: "UNAUTHORIZED",
            message: `ElevenLabs returned HTTP ${res.status}. Falling back cleanly.`,
          };
        }

        if (res.status === 429 && attempt < 2) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, delays[attempt]));
            continue;
          }
          return {
            ok: false,
            reason: res.status === 429 ? "RATE_LIMIT" : "API_ERROR",
            message: `ElevenLabs HTTP ${res.status}: ${errText.slice(0, 200)}`,
          };
        }

        const arrayBuf = await res.arrayBuffer();
        return {
          ok: true,
          audioBuffer: Buffer.from(arrayBuf),
          mimeType: "audio/mpeg",
          charsUsed: params.text.length,
          voiceId,
        };
      } catch (err) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        return {
          ok: false,
          reason: "API_ERROR",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return {
      ok: false,
      reason: "API_ERROR",
      message: "ElevenLabs retries exhausted.",
    };
  },
};

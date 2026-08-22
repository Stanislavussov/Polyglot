/**
 * Text-to-speech via OpenRouter's audio endpoint.
 *
 * Kept out of {@link ./generate.ts} on purpose: `@openrouter/ai-sdk-provider` has
 * no speech surface, and `POST /api/v1/audio/speech` returns **raw audio bytes,
 * not JSON**, so none of the AI SDK's response handling applies. What is shared is
 * the discipline — the same injected API key, the same abort-budget contract, and
 * the same metric sink — so a hung TTS call cannot hold a socket any longer than a
 * hung completion can.
 */

import { AITimeoutError } from "@polyglot/core";
import { getApiKey } from "./client.js";
import { logRequest } from "./logger.js";
import { createRequestTimeout, resolveRequestTimeoutMs } from "./timeout.js";

const SPEECH_ENDPOINT = "https://openrouter.ai/api/v1/audio/speech";

/**
 * `mp3` rather than the endpoint's `pcm` default. Telegram's `sendVoice` accepts
 * mp3 directly, so the bytes go straight through — choosing pcm would force an
 * ffmpeg transcode and a new dependency in the bot image for no gain.
 */
const RESPONSE_FORMAT = "mp3";

/** How much of a provider error body is worth carrying into the log line. */
const MAX_ERROR_BODY_CHARS = 300;

export interface GenerateSpeechOptions {
  /** Text to speak. Callers enforce their own length cap before getting here. */
  text: string;
  /** OpenRouter speech model id, e.g. "google/gemini-3.1-flash-tts-preview". */
  modelId: string;
  /** Voice name; omitted from the request body when empty. */
  voice: string;
  /** Attributed in the metric sink so TTS latency is trendable per user cohort. */
  userId?: number;
}

export interface GeneratedSpeech {
  bytes: Uint8Array;
  /** OpenRouter's `X-Generation-Id`, for cost lookup and support debugging. */
  generationId: string | null;
}

/**
 * Synthesize speech. Throws {@link AITimeoutError} when the request budget
 * elapses, and a plain Error carrying the provider status on any non-2xx.
 */
export async function generateSpeech(options: GenerateSpeechOptions): Promise<GeneratedSpeech> {
  const budgetMs = await resolveRequestTimeoutMs();
  const timeout = createRequestTimeout(budgetMs);
  const start = Date.now();

  try {
    const response = await fetch(SPEECH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.modelId,
        input: options.text,
        response_format: RESPONSE_FORMAT,
        // Models with no voice concept reject an empty `voice`; omit it entirely.
        ...(options.voice ? { voice: options.voice } : {}),
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, MAX_ERROR_BODY_CHARS);
      throw new Error(`OpenRouter TTS failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("OpenRouter TTS returned an empty audio body");
    }

    logSpeechRequest(options, budgetMs, Date.now() - start, timeout.timedOut(), null);
    return { bytes, generationId: response.headers.get("X-Generation-Id") };
  } catch (error) {
    const normalized = timeout.timedOut() ? new AITimeoutError(budgetMs) : error;
    logSpeechRequest(options, budgetMs, Date.now() - start, timeout.timedOut(), normalized);
    throw normalized;
  } finally {
    timeout.clear();
  }
}

/**
 * Feed the shared AI metric sink. Token counts and cost are zero by construction:
 * this endpoint bills per character and reports no usage, and `ai_models` carries
 * no pricing for speech models — inventing a number here would be worse than
 * recording none. Character volume is metered on the bot side instead.
 */
function logSpeechRequest(
  options: GenerateSpeechOptions,
  budgetMs: number,
  durationMs: number,
  timedOut: boolean,
  error: unknown,
): void {
  logRequest({
    model: options.modelId,
    requestKind: "speech",
    tokens: { input: 0, output: 0 },
    cost_usd: 0,
    duration_ms: durationMs,
    success: error === null,
    userId: options.userId,
    budgetMs,
    timedOut,
    ...(error === null ? {} : { error: error instanceof Error ? error.message : String(error) }),
  });
}

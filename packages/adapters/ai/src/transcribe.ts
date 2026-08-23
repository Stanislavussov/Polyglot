/**
 * Speech-to-text via OpenRouter's audio endpoint.
 *
 * Kept alongside {@link ./speech.ts} rather than in `generate.ts` for the same
 * reason: `@openrouter/ai-sdk-provider` has no transcription surface, so this
 * calls `POST /api/v1/audio/transcriptions` directly with `fetch`. Unlike TTS
 * (raw bytes back), this endpoint returns JSON with real usage/cost, which is
 * fed into the same metric sink so transcription latency and spend are
 * trendable alongside every other AI request kind.
 */

import { AITimeoutError } from "@polyglot/core";
import { getApiKey } from "./client.js";
import { logRequest } from "./logger.js";
import { createRequestTimeout, resolveRequestTimeoutMs } from "./timeout.js";

const TRANSCRIPTIONS_ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";

/** How much of a provider error body is worth carrying into the log line. */
const MAX_ERROR_BODY_CHARS = 300;

export interface TranscribeAudioOptions {
  /** Raw audio bytes (e.g. a Telegram voice message's OGG/Opus payload). */
  audio: Uint8Array;
  /** Audio container format, passed through to the provider as-is. */
  format: "ogg" | "mp3" | "wav";
  /** OpenRouter transcription model id — resolved from settings, never hardcoded. */
  modelId: string;
  /** Attributed in the metric sink so STT latency is trendable per user cohort. */
  userId?: number;
}

export interface TranscribedAudio {
  /** Trimmed transcript text. */
  text: string;
  /** Audio duration billed by the provider, or null when the response omits it. */
  seconds: number | null;
  /** Provider-reported cost in USD, or null when the response omits it. */
  costUsd: number | null;
  /** OpenRouter's `X-Generation-Id`, for cost lookup and support debugging. */
  generationId: string | null;
}

/** Shape of the fields this adapter reads from the transcriptions response body. */
interface TranscriptionResponseBody {
  text?: unknown;
  usage?: {
    seconds?: unknown;
    cost?: unknown;
  };
}

/**
 * Transcribe speech to text. Throws {@link AITimeoutError} when the request
 * budget elapses, and a plain Error carrying the provider status on any non-2xx.
 */
export async function transcribeAudio(options: TranscribeAudioOptions): Promise<TranscribedAudio> {
  const budgetMs = await resolveRequestTimeoutMs();
  const timeout = createRequestTimeout(budgetMs);
  const start = Date.now();

  try {
    const response = await fetch(TRANSCRIPTIONS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.modelId,
        input_audio: {
          data: Buffer.from(options.audio).toString("base64"),
          format: options.format,
        },
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, MAX_ERROR_BODY_CHARS);
      throw new Error(
        `OpenRouter transcription failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
      );
    }

    const json = (await response.json()) as TranscriptionResponseBody;
    const text = typeof json.text === "string" ? json.text.trim() : "";
    const seconds = typeof json.usage?.seconds === "number" ? json.usage.seconds : null;
    const costUsd = typeof json.usage?.cost === "number" ? json.usage.cost : null;
    const generationId = response.headers.get("X-Generation-Id");

    logTranscriptionRequest(options, budgetMs, Date.now() - start, timeout.timedOut(), costUsd, null);
    return { text, seconds, costUsd, generationId };
  } catch (error) {
    const normalized = timeout.timedOut() ? new AITimeoutError(budgetMs) : error;
    logTranscriptionRequest(options, budgetMs, Date.now() - start, timeout.timedOut(), null, normalized);
    throw normalized;
  } finally {
    timeout.clear();
  }
}

/**
 * Feed the shared AI metric sink. Token counts are zero by construction: this
 * endpoint bills per audio second, not per token, and `usage.seconds` has no
 * home in the shared `tokens` shape — cost is real and comes straight from the
 * response body, unlike TTS which has no usage at all.
 */
function logTranscriptionRequest(
  options: TranscribeAudioOptions,
  budgetMs: number,
  durationMs: number,
  timedOut: boolean,
  costUsd: number | null,
  error: unknown,
): void {
  logRequest({
    model: options.modelId,
    requestKind: "transcription",
    tokens: { input: 0, output: 0 },
    cost_usd: costUsd ?? 0,
    duration_ms: durationMs,
    success: error === null,
    userId: options.userId,
    budgetMs,
    timedOut,
    ...(error === null ? {} : { error: error instanceof Error ? error.message : String(error) }),
  });
}

import { errorFields, FEATURE_KEYS, logEvent } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import type { WebServices } from "../services.js";
import { featureLocked, hasFeature } from "./card-explore.js";

// 16 kHz mono 16-bit for a few minutes, with headroom: the duration rule below is what limits a recording.
const MAX_WAV_BYTES = 8 * 1024 * 1024;
const WAV_HEADER_BYTES = 44;

/**
 * Seconds of audio in a canonical PCM WAV, or null when the bytes are not one. The browser
 * records WAV because the transcription port takes ogg/mp3/wav and MediaRecorder gives
 * webm or mp4 depending on the browser — neither of which the provider accepts.
 */
export function wavDurationSec(bytes: Uint8Array): number | null {
  if (bytes.length < WAV_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const byteRate = view.getUint32(28, true);
  if (byteRate === 0) return null;
  return (bytes.length - WAV_HEADER_BYTES) / byteRate;
}

/** The bot's voice message (helpers/voice-input.ts): same STT switch, paid gate, length limit and model. */
export function voiceRoutes(app: FastifyInstance, services: WebServices): void {
  app.addContentTypeParser("audio/wav", { parseAs: "buffer", bodyLimit: MAX_WAV_BYTES }, (_request, body, done) =>
    done(null, body),
  );

  app.post("/api/voice/transcribe", async (request, reply) => {
    const stt = await services.settings.getSttConfig();
    // An empty model id means the same as disabled — there is nothing to call.
    if (!stt.enabled || !stt.modelId.trim()) return reply.status(404).send({ code: "voice_off" });
    const user = request.learner;
    if (!(await hasFeature(services, user, FEATURE_KEYS.voiceInput))) {
      return featureLocked(reply, FEATURE_KEYS.voiceInput);
    }

    const audio = request.body instanceof Uint8Array ? request.body : null;
    const durationSec = audio ? wavDurationSec(audio) : null;
    if (!audio || durationSec === null) return reply.status(400).send({ code: "invalid_audio" });
    if (durationSec > stt.maxDurationSec) {
      logEvent("voice.too_long", { durationSec, maxDurationSec: stt.maxDurationSec, surface: "web" });
      return reply.status(422).send({ code: "voice_too_long", max: stt.maxDurationSec });
    }

    let text: string;
    try {
      const result = await services.ai.transcribe({ audio, format: "wav", modelId: stt.modelId, userId: user.id });
      text = result.text.trim();
      logEvent("voice.transcribed", {
        durationSec,
        chars: text.length,
        generationId: result.generationId,
        surface: "web",
      });
    } catch (err) {
      logEvent("voice.transcribe_failed", { durationSec, surface: "web", ...errorFields(err) }, "error");
      return reply.status(502).send({ code: "voice_failed" });
    }
    if (!text) {
      logEvent("voice.transcribe_empty", { durationSec, surface: "web" });
      return reply.status(422).send({ code: "voice_failed" });
    }
    return { text, maxDurationSec: stt.maxDurationSec };
  });
}

/**
 * Voice input on the web, as the bot's voice message (helpers/voice-input.ts):
 * - the STT switch off → nothing is transcribed;
 * - the voiceInput feature is paid: a free learner is refused before the AI is called;
 * - a recording longer than the configured limit is refused before the AI is called;
 * - a Pro learner's WAV reaches `ai.transcribe` with the configured model and the text comes back.
 */
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness, WEB_ORIGIN } from "./test-helpers/web-harness.js";

const STT_MODEL = "openai/whisper-large-v3-turbo";
const STT_ENABLED = { enabled: true, modelId: STT_MODEL, maxDurationSec: 60 };

const BYTE_RATE = 32_000; // 16 kHz mono 16-bit

function wav(seconds: number): Buffer {
  const data = Math.round(seconds * BYTE_RATE);
  const buf = Buffer.alloc(44 + data);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + data, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16_000, 24);
  buf.writeUInt32LE(BYTE_RATE, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(data, 40);
  return buf;
}

async function setUp(plan: "free" | "pro", stt = STT_ENABLED) {
  const transcribe = vi.fn().mockResolvedValue({ text: " hello ", seconds: 2, costUsd: 0.0002, generationId: "gen" });
  const web = await createWebHarness({
    ai: { ...deterministicTranslateAi(), transcribe },
    settings: { getSttConfig: vi.fn().mockResolvedValue(stt) },
  });
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, { plan });
  const { cookie } = await web.login(telegramId);
  const send = async (payload: Buffer) => {
    const res = await web.app.inject({
      method: "POST",
      url: "/api/voice/transcribe",
      headers: { cookie, origin: WEB_ORIGIN, "content-type": "audio/wav" },
      payload,
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
  return { send, transcribe, userId };
}

describe("web voice input", () => {
  it("transcribes a Pro learner's recording with the configured model", async () => {
    const { send, transcribe, userId } = await setUp("pro");
    const audio = wav(2);

    expect(await send(audio)).toMatchObject({ status: 200, body: { text: "hello" } });
    expect(transcribe.mock.calls[0]![0]).toMatchObject({ format: "wav", modelId: STT_MODEL, userId });
    expect(Buffer.from(transcribe.mock.calls[0]![0].audio)).toEqual(audio);
  });

  it("refuses a free learner, a too-long recording and a disabled switch before calling the AI", async () => {
    const free = await setUp("free");
    expect(await free.send(wav(1))).toMatchObject({ status: 403, body: { code: "feature_locked" } });

    const pro = await setUp("pro");
    expect(await pro.send(wav(61))).toMatchObject({ status: 422, body: { code: "voice_too_long", max: 60 } });
    expect((await pro.send(Buffer.from("not audio at all, definitely not a wav file header"))).status).toBe(400);

    const off = await setUp("pro", { ...STT_ENABLED, enabled: false });
    expect(await off.send(wav(1))).toMatchObject({ status: 404, body: { code: "voice_off" } });

    expect(free.transcribe).not.toHaveBeenCalled();
    expect(pro.transcribe).not.toHaveBeenCalled();
    expect(off.transcribe).not.toHaveBeenCalled();
  });
});

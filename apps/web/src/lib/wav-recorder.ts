// The transcription provider takes ogg/mp3/wav, while MediaRecorder gives webm (Chrome)
// or mp4 (Safari). Recording raw PCM and writing a WAV ourselves works in every browser.
const TARGET_RATE = 16_000;

export interface WavRecording {
  stop(): Promise<Blob>;
  cancel(): void;
}

function downsample(chunks: Float32Array[], from: number): Int16Array {
  const all = new Float32Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  const ratio = from / TARGET_RATE;
  const out = new Int16Array(Math.floor(all.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const sample = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)] ?? 0));
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return out;
}

function encodeWav(samples: Int16Array): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) header.setUint8(at + i, text.charCodeAt(i));
  };
  const dataBytes = samples.length * 2;
  write(0, "RIFF");
  header.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, TARGET_RATE, true);
  header.setUint32(28, TARGET_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  write(36, "data");
  header.setUint32(40, dataBytes, true);
  return new Blob([header.buffer, samples.buffer as ArrayBuffer], { type: "audio/wav" });
}

export async function startWavRecording(): Promise<WavRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated but needs no separate worklet module, which the CSP would have to allow.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(processor);
  processor.connect(context.destination);

  const release = () => {
    processor.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  return {
    async stop() {
      release();
      return encodeWav(downsample(chunks, context.sampleRate));
    },
    cancel: release,
  };
}

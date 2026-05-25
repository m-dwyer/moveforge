import { readFile, writeFile } from "node:fs/promises";

export type WavData = {
  channels: number;
  frames: number;
  sampleRate: number;
  /** Float samples in [-1, 1], interleaved if stereo. */
  samples: Float32Array;
};

export async function readWav(path: string): Promise<WavData> {
  const buffer = await readFile(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (cc(view, 0) !== "RIFF" || cc(view, 8) !== "WAVE") throw new Error(`${path}: not RIFF/WAVE`);
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= view.byteLength) {
    const id = cc(view, offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || bits !== 16) throw new Error(`${path}: need 16-bit PCM (got ${bits})`);
  const frames = dataBytes / (channels * 2);
  const samples = new Float32Array(frames * channels);
  for (let i = 0; i < frames * channels; i++) {
    samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }
  return { channels, frames, sampleRate, samples };
}

export async function writeWav(path: string, wav: WavData): Promise<void> {
  const dataBytes = wav.frames * wav.channels * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(wav.channels, 22);
  buf.writeUInt32LE(wav.sampleRate, 24);
  buf.writeUInt32LE(wav.sampleRate * wav.channels * 2, 28);
  buf.writeUInt16LE(wav.channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < wav.samples.length; i++) {
    let v = Math.round(Math.max(-1, Math.min(1, wav.samples[i])) * 32767);
    if (v < -32768) v = -32768;
    if (v > 32767) v = 32767;
    buf.writeInt16LE(v, 44 + i * 2);
  }
  await writeFile(path, buf);
}

function cc(view: DataView, off: number): string {
  return String.fromCharCode(
    view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)
  );
}

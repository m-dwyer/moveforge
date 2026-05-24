import { readFile } from "node:fs/promises";

const SILENCE_THRESHOLD = 0.001;
const CLIP_THRESHOLD = 32766;

export async function metricsForWavFile(path) {
  const buffer = await readFile(path);
  return metricsForWavBuffer(buffer);
}

export function metricsForWavBuffer(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (read4cc(view, 0) !== "RIFF" || read4cc(view, 8) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= view.byteLength) {
    const id = read4cc(view, offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true)
      };
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error("missing fmt or data chunk");
  if (fmt.format !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`unsupported PCM format: code=${fmt.format} bits=${fmt.bitsPerSample}`);
  }

  const channels = fmt.channels;
  const frames = dataBytes / (channels * 2);
  let peak = 0;
  let sumSquares = 0;
  let sum = 0;
  let clipped = 0;
  let silentSamples = 0;
  const totalSamples = frames * channels;
  const zeroCrossings = new Array(channels).fill(0);
  const lastSign = new Array(channels).fill(0);
  let crossL = 0;
  let crossR = 0;
  let sumL2 = 0;
  let sumR2 = 0;

  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const raw = view.getInt16(dataOffset + (f * channels + c) * 2, true);
      const norm = raw / 32768;
      const abs = Math.abs(norm);
      if (abs > peak) peak = abs;
      sumSquares += norm * norm;
      sum += norm;
      if (abs < SILENCE_THRESHOLD) silentSamples++;
      if (Math.abs(raw) >= CLIP_THRESHOLD) clipped++;
      const sign = norm > 0 ? 1 : norm < 0 ? -1 : 0;
      if (sign !== 0 && lastSign[c] !== 0 && sign !== lastSign[c]) zeroCrossings[c]++;
      if (sign !== 0) lastSign[c] = sign;
      if (channels === 2) {
        if (c === 0) {
          sumL2 += norm * norm;
          crossL += norm * (view.getInt16(dataOffset + (f * 2 + 1) * 2, true) / 32768);
        } else {
          sumR2 += norm * norm;
        }
      }
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, totalSamples));
  const dcOffset = sum / Math.max(1, totalSamples);
  const zcrPerChannel = zeroCrossings.map((count) => count / Math.max(1, frames - 1));
  const stereoCorrelation = channels === 2 && sumL2 > 0 && sumR2 > 0
    ? crossL / Math.sqrt(sumL2 * sumR2)
    : null;

  return {
    sample_rate: fmt.sampleRate,
    channels,
    frames,
    duration_seconds: round(frames / fmt.sampleRate, 4),
    peak: round(peak, 5),
    rms: round(rms, 5),
    dc_offset: round(dcOffset, 6),
    silence_ratio: round(silentSamples / Math.max(1, totalSamples), 4),
    clipped_samples: clipped,
    zero_crossing_rate: zcrPerChannel.map((v) => round(v, 5)),
    stereo_correlation: stereoCorrelation == null ? null : round(stereoCorrelation, 4)
  };
}

function read4cc(view, off) {
  return String.fromCharCode(
    view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)
  );
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

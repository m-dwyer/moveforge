import { readFile } from "node:fs/promises";

const SILENCE_THRESHOLD = 0.001;
const CLIP_THRESHOLD = 32766;

/* Upper edges of 8 log-spaced bands, in Hz. Reported in dB relative to total
 * spectral energy, so the vector describes spectral *shape* independently of
 * level — level changes are already covered by peak and rms.
 *
 * dB, not fractions: a fraction gives a quiet band almost no dynamic range, so
 * any absolute tolerance wide enough to survive compiler noise in a loud band
 * makes quiet bands unprotected — the same failure as the abs-first tolerance
 * this project already had. In dB a 25% energy change is ~1 dB whether the band
 * holds most of the signal or a thousandth of it. */
const BAND_EDGES_HZ = [100, 250, 600, 1500, 3500, 8000, 15000, Infinity];
const FFT_SIZE = 4096;
/* Bands/segments below this contribute nothing audible; clamping keeps two
 * effectively-empty bands comparing equal instead of showing noise as drift. */
const ENERGY_FLOOR_DB = -60;

export type WavMetrics = {
  sample_rate: number;
  channels: number;
  frames: number;
  duration_seconds: number;
  peak: number;
  rms: number;
  dc_offset: number;
  dc_offset_per_channel: number[];
  silence_ratio: number;
  clipped_samples: number;
  zero_crossing_rate: number[];
  stereo_correlation: number | null;
  slew_ratio: number;
  time_profile: number[];
  band_energy: number[];
};

type PcmFormat = {
  bitsPerSample: number;
  channels: number;
  format: number;
  sampleRate: number;
};

export async function metricsForWavFile(path: string): Promise<WavMetrics> {
  const buffer = await readFile(path);
  return metricsForWavBuffer(buffer);
}

export function metricsForWavBuffer(buffer: Buffer): WavMetrics {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (read4cc(view, 0) !== "RIFF" || read4cc(view, 8) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt: PcmFormat | null = null;
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
  let sumAbsDelta = 0;
  const totalSamples = frames * channels;
  const zeroCrossings = new Array(channels).fill(0);
  const lastSign = new Array(channels).fill(0);
  const sumPerChannel = new Array(channels).fill(0);
  const prevPerChannel = new Array(channels).fill(0);
  let crossL = 0;
  let crossR = 0;
  let sumL2 = 0;
  let sumR2 = 0;
  /* Mono mixdown, retained for the spectral and temporal metrics below. */
  const mono = new Float64Array(frames);

  for (let f = 0; f < frames; f++) {
    let frameSum = 0;
    for (let c = 0; c < channels; c++) {
      const raw = view.getInt16(dataOffset + (f * channels + c) * 2, true);
      const norm = raw / 32768;
      const abs = Math.abs(norm);
      if (abs > peak) peak = abs;
      sumSquares += norm * norm;
      sum += norm;
      sumPerChannel[c] += norm;
      if (abs < SILENCE_THRESHOLD) silentSamples++;
      if (Math.abs(raw) >= CLIP_THRESHOLD) clipped++;
      if (f > 0) sumAbsDelta += Math.abs(norm - prevPerChannel[c]);
      prevPerChannel[c] = norm;
      const sign = norm > 0 ? 1 : norm < 0 ? -1 : 0;
      if (sign !== 0 && lastSign[c] !== 0 && sign !== lastSign[c]) zeroCrossings[c]++;
      if (sign !== 0) lastSign[c] = sign;
      frameSum += norm;
      if (channels === 2) {
        if (c === 0) {
          sumL2 += norm * norm;
          crossL += norm * (view.getInt16(dataOffset + (f * 2 + 1) * 2, true) / 32768);
        } else {
          sumR2 += norm * norm;
        }
      }
    }
    mono[f] = frameSum / channels;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, totalSamples));
  const dcOffset = sum / Math.max(1, totalSamples);
  const zcrPerChannel = zeroCrossings.map((count) => count / Math.max(1, frames - 1));
  const stereoCorrelation = channels === 2 && sumL2 > 0 && sumR2 > 0
    ? crossL / Math.sqrt(sumL2 * sumR2)
    : null;

  /* Mean |x[n] - x[n-1]| normalized by rms: a level-independent roughness /
   * spectral-tilt proxy. Catches envelope clicks, delay-time jumps, and
   * discontinuities that peak and rms are blind to. */
  const meanAbsDelta = sumAbsDelta / Math.max(1, (frames - 1) * channels);
  const slewRatio = rms > 0 ? meanAbsDelta / rms : 0;



  return {
    sample_rate: fmt.sampleRate,
    channels,
    frames,
    duration_seconds: round(frames / fmt.sampleRate, 4),
    peak: round(peak, 5),
    rms: round(rms, 5),
    dc_offset: round(dcOffset, 6),
    dc_offset_per_channel: sumPerChannel.map((s) => round(s / Math.max(1, frames), 6)),
    silence_ratio: round(silentSamples / Math.max(1, totalSamples), 4),
    clipped_samples: clipped,
    zero_crossing_rate: zcrPerChannel.map((v) => round(v, 5)),
    stereo_correlation: stereoCorrelation == null ? null : round(stereoCorrelation, 4),
    slew_ratio: round(slewRatio, 5),
    time_profile: timeProfile(mono).map((v) => round(v, 2)),
    band_energy: bandEnergy(mono, fmt.sampleRate).map((v) => round(v, 2))
  };
}

/* Fraction of total energy in each of 8 equal time segments — the temporal
 * analogue of band_energy, and level-independent for the same reason.
 *
 * This is what catches an FX whose wet path dies: all the energy collapses into
 * the first segment while peak barely moves. It also catches truncated renders,
 * envelope shape changes, and tails that stop decaying. */
function timeProfile(mono: Float64Array): number[] {
  const segments = 8;
  const out = new Array(segments).fill(0);
  if (mono.length === 0) return out.map(() => ENERGY_FLOOR_DB);
  for (let i = 0; i < mono.length; i++) {
    const seg = Math.min(segments - 1, Math.floor((i * segments) / mono.length));
    out[seg] += mono[i] * mono[i];
  }
  return asRelativeDb(out);
}

/* Convert a vector of energies to dB relative to their total. */
function asRelativeDb(energies: number[]): number[] {
  const total = energies.reduce((a, b) => a + b, 0);
  if (total <= 0) return energies.map(() => ENERGY_FLOOR_DB);
  return energies.map((v) => {
    if (v <= 0) return ENERGY_FLOOR_DB;
    const db = 10 * Math.log10(v / total);
    return db < ENERGY_FLOOR_DB ? ENERGY_FLOOR_DB : db;
  });
}

/* Welch-style band energy: Hann-windowed FFT over 50%-overlapped frames,
 * power accumulated into log-spaced bands, returned as fractions of the total.
 *
 * This is the metric that catches what scalar level checks cannot: aliasing,
 * a filter running backwards, a saturator's harmonic content changing, or a
 * wet path going missing. */
function bandEnergy(mono: Float64Array, sampleRate: number): number[] {
  const bands = new Array(BAND_EDGES_HZ.length).fill(0);
  if (mono.length < FFT_SIZE) return bands.map(() => ENERGY_FLOOR_DB);

  const window = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  }

  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const hop = FFT_SIZE / 2;
  const binHz = sampleRate / FFT_SIZE;
  let frames = 0;

  for (let start = 0; start + FFT_SIZE <= mono.length; start += hop) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    /* Skip bin 0 (DC — reported separately as dc_offset). */
    for (let bin = 1; bin < FFT_SIZE / 2; bin++) {
      const power = re[bin] * re[bin] + im[bin] * im[bin];
      const hz = bin * binHz;
      let b = 0;
      while (b < BAND_EDGES_HZ.length - 1 && hz >= BAND_EDGES_HZ[b]) b++;
      bands[b] += power;
    }
    frames++;
  }

  if (frames === 0) return bands.map(() => ENERGY_FLOOR_DB);
  return asRelativeDb(bands);
}

/* Iterative radix-2 Cooley-Tukey. Length must be a power of two.
 *
 * Exported so the palette tool shares this one implementation: a second FFT in
 * the tree would drift from this one in windowing or scaling and quietly make
 * two reports of the same render disagree. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

function read4cc(view: DataView, off: number): string {
  return String.fromCharCode(
    view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3)
  );
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

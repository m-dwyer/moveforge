import { fftInPlace } from "../wav-metrics.ts";

/* Perceptual descriptors for one rendered hit.
 *
 * Deliberately not the same set as scripts/wav-metrics.ts. Those metrics answer
 * "did this change since the golden" — they are level-relative, whole-file, and
 * tuned to be stable. These answer "what does this sound like", which needs
 * absolute figures, a single hit rather than a whole pattern, and descriptors
 * that map onto words someone would use about a drum: how bright, how noisy,
 * how long, how punchy.
 *
 * The FFT is imported rather than reimplemented, so the two reports cannot
 * disagree about windowing or scaling.
 */

export type Descriptors = {
  /* Peak sample, dBFS. -Infinity for silence. */
  peakDb: number;
  /* -60 dB time of the RMS envelope, milliseconds. null if it never gets there
   * inside the render, which is itself worth reporting. */
  t60Ms: number | null;
  /* Time from onset to peak, milliseconds. Separates a click from a swell. */
  attackMs: number;
  /* Amplitude-weighted mean frequency over the first 250 ms. */
  centroidHz: number;
  /* Fraction of energy above 4 kHz, 0..1. "Is this a hat or a tom." */
  bright: number;
  /* Spectral flatness over 2-14 kHz: 1 is white, a handful of tones is near 0.
   * This is what separates a wash from a bell and no level metric can see it. */
  flatness: number;
  /* Peak over RMS, dB. High is transient, low is sustained. */
  crestDb: number;
  /* Side energy over mid energy. 0 is mono; a stereo spread control that does
   * nothing to this is doing nothing. Kept here rather than derived later
   * because a mono mixdown destroys it, and a report that mixes to mono before
   * measuring will call every pan control dead. */
  width: number;
  /* True when nothing crossed the onset threshold at all. */
  silent: boolean;
};

const FFT_SIZE = 4096;
const ONSET = 0.002;

export function describe(mono: Float64Array, sampleRate: number,
                         side?: Float64Array): Descriptors {
  const silentResult: Descriptors = {
    peakDb: -Infinity, t60Ms: null, attackMs: 0, centroidHz: 0,
    bright: 0, flatness: 0, crestDb: 0, width: 0, silent: true
  };

  let onset = -1;
  for (let i = 0; i < mono.length; i++) {
    if (Math.abs(mono[i]) > ONSET) { onset = i; break; }
  }
  if (onset < 0) return silentResult;

  const seg = mono.subarray(onset);

  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < seg.length; i++) {
    const a = Math.abs(seg[i]);
    if (a > peak) { peak = a; peakAt = i; }
  }
  if (peak <= 0) return silentResult;

  /* RMS envelope in 5 ms windows. Coarse on purpose: a finer window tracks the
   * waveform's own oscillation and reports a decay that swings with the phase
   * of the lowest partial. */
  const w = Math.max(1, Math.round(0.005 * sampleRate));
  const blocks = Math.floor(seg.length / w);
  const env = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let acc = 0;
    for (let i = 0; i < w; i++) { const v = seg[b * w + i]; acc += v * v; }
    env[b] = Math.sqrt(acc / w);
  }
  let e0 = 0;
  for (let b = 0; b < Math.min(3, blocks); b++) if (env[b] > e0) e0 = env[b];

  let t60Ms: number | null = null;
  if (e0 > 0) {
    for (let b = 3; b < blocks; b++) {
      if (20 * Math.log10(env[b] / e0 + 1e-12) < -60) { t60Ms = b * 5; break; }
    }
  }

  /* Spectrum of the first 250 ms: the part that decides what the hit sounds
   * like. Reading the whole render instead would average a 40 ms hat with the
   * silence after it and report something neither. */
  const window = Math.min(Math.round(0.25 * sampleRate), seg.length);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const n = Math.min(FFT_SIZE, window);
  for (let i = 0; i < n; i++) {
    re[i] = seg[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  fftInPlace(re, im);

  const binHz = sampleRate / FFT_SIZE;
  let num = 0, den = 0, total = 0, above4k = 0;
  let logSum = 0, linSum = 0, bandBins = 0;
  for (let bin = 1; bin < FFT_SIZE / 2; bin++) {
    const power = re[bin] * re[bin] + im[bin] * im[bin];
    const mag = Math.sqrt(power);
    const hz = bin * binHz;
    num += mag * hz;
    den += mag;
    total += power;
    if (hz >= 4000) above4k += power;
    if (hz >= 2000 && hz < 14000) {
      logSum += Math.log(mag + 1e-12);
      linSum += mag + 1e-12;
      bandBins++;
    }
  }

  let rms = 0;
  const rmsN = Math.min(window, seg.length);
  for (let i = 0; i < rmsN; i++) rms += seg[i] * seg[i];
  rms = Math.sqrt(rms / Math.max(1, rmsN));

  return {
    peakDb: 20 * Math.log10(peak),
    t60Ms,
    attackMs: (peakAt / sampleRate) * 1000,
    centroidHz: den > 0 ? num / den : 0,
    bright: total > 0 ? above4k / total : 0,
    flatness: bandBins > 0 ? Math.exp(logSum / bandBins) / (linSum / bandBins) : 0,
    crestDb: rms > 0 ? 20 * Math.log10(peak / rms) : 0,
    width: widthOf(mono, side, onset, rmsN),
    silent: false
  };
}

function widthOf(mono: Float64Array, side: Float64Array | undefined,
                 onset: number, n: number): number {
  if (!side) return 0;
  let m = 0, sd = 0;
  for (let i = 0; i < n && onset + i < mono.length; i++) {
    m += mono[onset + i] * mono[onset + i];
    sd += side[onset + i] * side[onset + i];
  }
  return m > 0 ? Math.sqrt(sd / m) : 0;
}

/* A one-line reading in the words someone would actually use. The thresholds
 * are coarse because the number is printed beside it — this exists so a table
 * of sixty rows can be skimmed, not to replace the figures. */
export function fingerprint(d: Descriptors): string {
  if (d.silent) return "silent";
  const bright = d.centroidHz >= 6000 ? "bright"
    : d.centroidHz >= 2500 ? "mid"
    : d.centroidHz >= 800 ? "warm" : "low";
  const texture = d.flatness >= 0.45 ? "noisy"
    : d.flatness >= 0.20 ? "grainy" : "tonal";
  const length = d.t60Ms === null ? "unending"
    : d.t60Ms >= 1000 ? "long"
    : d.t60Ms >= 300 ? "medium"
    : d.t60Ms >= 90 ? "short" : "tight";
  return `${bright} ${texture} ${length}`;
}

/* How far a descriptor travelled across a sweep, in units a reader can judge.
 * Frequency in octaves and time in doublings, because a knob that moves a
 * centroid 200 Hz means something completely different at 300 Hz and at 9 kHz. */
export function spreadOf(values: number[], kind: "ratio" | "linear"): number {
  const usable = values.filter((v) => Number.isFinite(v) && (kind === "linear" || v > 0));
  if (usable.length < 2) return 0;
  const lo = Math.min(...usable);
  const hi = Math.max(...usable);
  if (kind === "linear") return hi - lo;
  return lo > 0 ? Math.log2(hi / lo) : 0;
}

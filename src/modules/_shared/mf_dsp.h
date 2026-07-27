#ifndef MOVEFORGE_MODULES_SHARED_MF_DSP_H
#define MOVEFORGE_MODULES_SHARED_MF_DSP_H

/* Shared DSP building blocks.
 *
 * Blocks a module would otherwise hand-roll. Everything here is header-only,
 * C11, allocation-free and safe to call from the audio thread.
 *
 * The rule this file exists to enforce: a module author should never be
 * hand-deriving a filter topology's stability condition, a PRNG, or a
 * denormal guard. Every block here replaced at least one hand-rolled copy that
 * was subtly wrong. See plans/harden-dsp-pipeline.md for the specifics.
 *
 * Contents:
 *   mf_flush_denorm      flush-to-zero for recursive state
 *   mf_is_bad/mf_sanitize non-finite and out-of-range guards
 *   mf_wrap_phase        wrap a normalized phase into [0, 1)
 *   mf_dcblock_t         one-pole DC blocker
 *   mf_onepole_t         one-pole lowpass with an Hz-set coefficient
 *   mf_svf_t             TPT/ZDF state-variable filter (unconditionally stable)
 *   mf_tilt_t            complementary tilt EQ, exactly transparent at 0 dB
 *   mf_smooth_t          one-pole parameter smoother
 *   mf_ar_t              attack/release envelope
 *   mf_tanh_approx       rational tanh, ~7 ops instead of a libm call
 *   mf_fold              triangle wavefolder
 *   mf_drive_t           five saturation curves behind one interface
 *   mf_rng_t             integer LCG noise source
 *   mf_beats_to_samples  tempo-relative lengths
 *
 * Sample rate is MOVEFORGE_SAMPLE_RATE throughout; nothing here reads the host
 * rate, matching the rest of the project's fixed-rate assumption. */

#include <math.h>
#include <stdint.h>

#include "modules/_shared/dsp_runtime.h"

/* ---------------------------------------------------------------------------
 * Denormal flush
 *
 * The device sets FPCR.FZ but not DAZ, and only on the SPI thread; offline
 * renders and the browser run with denormals live. Recursive state that decays
 * toward zero (filter memory, delay feedback, reverb tails) should be flushed
 * explicitly rather than relying on the host's FP environment.
 * ------------------------------------------------------------------------- */

#define MF_DENORM_FLOOR 1.0e-20f

static inline float mf_flush_denorm(float x)
{
    return (x > -MF_DENORM_FLOOR && x < MF_DENORM_FLOOR) ? 0.0f : x;
}

/* ---------------------------------------------------------------------------
 * Non-finite and range guards
 *
 * A NaN cannot be detected downstream: moveforge_float_to_i16's clamp
 * comparisons are both false for NaN, so it converts to 0 and a blowup renders
 * as digital silence. Guard recursive state where it is produced.
 * ------------------------------------------------------------------------- */

#define MF_STATE_LIMIT 1.0e6f

static inline int mf_is_bad(float x)
{
    return !isfinite(x) || x > MF_STATE_LIMIT || x < -MF_STATE_LIMIT;
}

/* Returns `fallback` for non-finite or absurd input, otherwise x unchanged. */
static inline float mf_sanitize(float x, float fallback)
{
    return mf_is_bad(x) ? fallback : x;
}

/* ---------------------------------------------------------------------------
 * Phase wrap
 * ------------------------------------------------------------------------- */

static inline float mf_wrap_phase(float phase)
{
    phase -= floorf(phase);
    return phase < 0.0f ? phase + 1.0f : phase;
}

/* ---------------------------------------------------------------------------
 * DC blocker (one-pole highpass)
 *
 * Place this *after* the last nonlinearity in a chain, not before. A saturator
 * fed an asymmetric waveform produces DC even when its input is zero-mean —
 * tanh compresses tall peaks more than shallow troughs — so a blocker upstream
 * of the output stage does not protect the output. dustline had a blocker
 * before its final tanh and still emitted 4.5% DC; faust_voice had none.
 *
 * Pole 0.9975 puts the corner near 17.5 Hz at 44.1 kHz: below the audible
 * fundamental range, so bass is preserved.
 * ------------------------------------------------------------------------- */

#define MF_DCBLOCK_POLE 0.9975f

typedef struct {
    float x1;
    float y1;
} mf_dcblock_t;

static inline void mf_dcblock_init(mf_dcblock_t *d)
{
    if (!d) return;
    d->x1 = 0.0f;
    d->y1 = 0.0f;
}

static inline float mf_dcblock_tick(mf_dcblock_t *d, float x)
{
    float y = x - d->x1 + MF_DCBLOCK_POLE * d->y1;
    d->x1 = x;
    d->y1 = mf_flush_denorm(y);
    return d->y1;
}

/* ---------------------------------------------------------------------------
 * State-variable filter (TPT / zero-delay-feedback, Zavalishin)
 *
 * Unconditionally stable for every g > 0 and k > 0, so cutoff and resonance can
 * be swept over their full ranges — including both at maximum — without a
 * stability cap. This is the property the naive Chamberlin SVF lacks: that form
 * requires both fq < 2 and f^2 + 2fq < 4, the second of which is easy to miss
 * and produces NaN rather than a graceful blowup.
 *
 * Usage — compute coefficients once per block, run per sample:
 *
 *     mf_svf_coeffs_t c;
 *     mf_svf_set(&c, cutoff_hz, resonance_0_to_1);
 *     for (int i = 0; i < frames; i++) {
 *         mf_svf_tick(&state, &c, input[i]);
 *         out[i] = state.lp;
 *     }
 *
 * `resonance` is normalized 0..1 and maps monotonically to peak gain: 0 is
 * flat (Q = 0.5), 1 is just short of self-oscillation (Q = 40). Higher input
 * means more resonance, which is the direction the label implies.
 * ------------------------------------------------------------------------- */

typedef struct {
    float g;  /* tan(pi * fc / sr)                */
    float k;  /* damping, 1/Q                     */
    float a1; /* 1 / (1 + g * (g + k))            */
    float a2; /* g * a1                           */
    float a3; /* g * a2                           */
} mf_svf_coeffs_t;

typedef struct {
    float ic1eq;
    float ic2eq;
    float lp;
    float bp;
    float hp;
} mf_svf_t;

static inline void mf_svf_init(mf_svf_t *s)
{
    if (!s) return;
    s->ic1eq = 0.0f;
    s->ic2eq = 0.0f;
    s->lp = 0.0f;
    s->bp = 0.0f;
    s->hp = 0.0f;
}

/* Map a normalized 0..1 resonance to the damping term k = 1/Q.
 *
 * Exponential in Q rather than linear in k, so the control is roughly constant
 * in dB-per-turn (~3.5 dB per 0.125 of travel) instead of doing nothing over
 * its bottom half and everything in its last tenth. Q spans 0.5 (flat) to 25
 * (a strong ring, just short of self-oscillation). */
#define MF_SVF_Q_MIN 0.5f
#define MF_SVF_Q_MAX 25.0f

static inline float mf_svf_damping_from_resonance(float resonance)
{
    float r = moveforge_clampf(resonance, 0.0f, 1.0f);
    float q = MF_SVF_Q_MIN * powf(MF_SVF_Q_MAX / MF_SVF_Q_MIN, r);
    return 1.0f / q;
}

/* cutoff_hz is clamped below Nyquist with margin; resonance is normalized 0..1. */
static inline void mf_svf_set(mf_svf_coeffs_t *c, float cutoff_hz, float resonance)
{
    if (!c) return;
    float fc = moveforge_clampf(cutoff_hz, 10.0f, MOVEFORGE_SAMPLE_RATE * 0.45f);
    /* Not M_PI: that is a POSIX extension, and glibc does not define it under
     * -std=c11 (which is what the aarch64 device build uses). Apple's libc does,
     * so using it compiles locally and fails only when cross-compiling. */
    c->g = tanf(MOVEFORGE_TWO_PI * 0.5f * fc / MOVEFORGE_SAMPLE_RATE);
    c->k = mf_svf_damping_from_resonance(resonance);
    c->a1 = 1.0f / (1.0f + c->g * (c->g + c->k));
    c->a2 = c->g * c->a1;
    c->a3 = c->g * c->a2;
}

/* Advance one sample. Leaves lp/bp/hp populated; pick the one you want. */
static inline void mf_svf_tick(mf_svf_t *s, const mf_svf_coeffs_t *c, float in)
{
    float v3 = in - s->ic2eq;
    float v1 = c->a1 * s->ic1eq + c->a2 * v3;
    float v2 = s->ic2eq + c->a2 * s->ic1eq + c->a3 * v3;

    s->ic1eq = mf_flush_denorm(2.0f * v1 - s->ic1eq);
    s->ic2eq = mf_flush_denorm(2.0f * v2 - s->ic2eq);

    s->lp = v2;
    s->bp = v1;
    s->hp = in - c->k * v1 - v2;
}

/* ---------------------------------------------------------------------------
 * One-pole lowpass
 *
 * The `y += a * (x - y)` filter every module ends up writing. Coefficient set
 * from a corner frequency so callers stop repeating the 2*pi*hz/sr conversion.
 * ------------------------------------------------------------------------- */

typedef struct {
    float y;
    float a;
} mf_onepole_t;

static inline void mf_onepole_init(mf_onepole_t *f)
{
    if (!f) return;
    f->y = 0.0f;
    f->a = 1.0f;
}

static inline void mf_onepole_set_hz(mf_onepole_t *f, float hz)
{
    if (!f) return;
    f->a = moveforge_clampf(MOVEFORGE_TWO_PI * hz / MOVEFORGE_SAMPLE_RATE, 0.0002f, 0.95f);
}

static inline float mf_onepole_tick(mf_onepole_t *f, float x)
{
    f->y += f->a * (x - f->y);
    f->y = mf_flush_denorm(f->y);
    return f->y;
}

/* ---------------------------------------------------------------------------
 * Tilt EQ
 *
 * One knob that tilts the spectrum about a pivot: lows up and highs down, or
 * the reverse. The most useful single tone control there is, and the one that
 * decides what a downstream saturator actually chews on — tilt up into a
 * clipper is a mid-forward, cutting sound; tilt down into a soft saturator is
 * a round one. Same drive stage, opposite characters.
 *
 * Built as a complementary crossover rather than a pair of shelving biquads:
 *
 *     low  = onepole(x);  high = x - low;  y = low * gl + high * gh
 *
 * `low + high == x` holds identically whatever the one-pole's response is, so
 * at 0 dB (gl == gh == 1) the filter is bit-exactly transparent rather than
 * approximately so. A shelving-biquad tilt has ripple at its centre detent,
 * which is audible as a tone change when a control that reads "flat" is not.
 * ------------------------------------------------------------------------- */

typedef struct {
    mf_onepole_t lp;
} mf_tilt_t;

static inline void mf_tilt_init(mf_tilt_t *t, float pivot_hz)
{
    if (!t) return;
    mf_onepole_init(&t->lp);
    mf_onepole_set_hz(&t->lp, pivot_hz);
}

/* `tilt` is bipolar -1..1; positive lifts highs and cuts lows by `max_db`/2
 * each, so the two ends are symmetric in dB and the midpoint is unity. */
static inline void mf_tilt_gains(float tilt, float max_db,
                                 float *gain_low, float *gain_high)
{
    float t = moveforge_clampf(tilt, -1.0f, 1.0f);
    float db = t * max_db * 0.5f;
    if (gain_high) *gain_high = powf(10.0f, db / 20.0f);
    if (gain_low) *gain_low = powf(10.0f, -db / 20.0f);
}

static inline float mf_tilt_tick(mf_tilt_t *t, float x,
                                 float gain_low, float gain_high)
{
    float low = mf_onepole_tick(&t->lp, x);
    float high = x - low;
    return low * gain_low + high * gain_high;
}

/* ---------------------------------------------------------------------------
 * Parameter smoother
 *
 * Unsmoothed parameters step once per block, which is a 344 Hz buzz while a
 * knob moves and a click on every preset load. Three incompatible versions of
 * this existed across the modules and four had none at all.
 *
 * Use mf_smooth_init_gain for anything that scales the output: it collapses to
 * silence faster than it rises, so `volume = 0` mutes promptly instead of
 * leaving an audible tail, and snaps to exact zero rather than decaying forever.
 * ------------------------------------------------------------------------- */

#define MF_SMOOTH_ZERO_EPS 1.0e-6f

typedef struct {
    float value;
    float coeff;       /* normal approach rate  */
    float mute_coeff;  /* rate when heading to zero */
} mf_smooth_t;

/* Coefficient for a one-pole reaching ~63% of a step in `ms`. */
static inline float mf_smooth_coeff_ms(float ms)
{
    float samples = (ms <= 0.0f) ? 1.0f : ms * 0.001f * MOVEFORGE_SAMPLE_RATE;
    if (samples < 1.0f) samples = 1.0f;
    return 1.0f / samples;
}

static inline void mf_smooth_init(mf_smooth_t *s, float ms)
{
    if (!s) return;
    s->value = 0.0f;
    s->coeff = mf_smooth_coeff_ms(ms);
    s->mute_coeff = s->coeff;
}

static inline void mf_smooth_init_gain(mf_smooth_t *s, float ms, float mute_ms)
{
    if (!s) return;
    mf_smooth_init(s, ms);
    s->mute_coeff = mf_smooth_coeff_ms(mute_ms);
}

/* Jump straight to a value — use on note-on so a fresh note does not glide in
 * from whatever the previous one left behind. */
static inline void mf_smooth_snap(mf_smooth_t *s, float value)
{
    if (!s) return;
    s->value = value;
}

static inline float mf_smooth_tick(mf_smooth_t *s, float target)
{
    float c = (target <= MF_SMOOTH_ZERO_EPS) ? s->mute_coeff : s->coeff;
    s->value += (target - s->value) * c;
    if (target <= MF_SMOOTH_ZERO_EPS && s->value < MF_SMOOTH_ZERO_EPS) s->value = 0.0f;
    return s->value;
}

/* ---------------------------------------------------------------------------
 * Attack / release envelope
 *
 * `sustain` is the level held while the gate is open, so this covers both a
 * plain AR (sustain 1.0) and the decay-to-a-hold-level shape westfold uses.
 * Coefficients are per-block work, not per-sample: set them once outside the
 * loop.
 * ------------------------------------------------------------------------- */

typedef struct {
    float value;
    float attack_coeff;
    float release_coeff;
} mf_ar_t;

/* 1 - exp(-1/(t*sr)): reaches ~63% of the way in `seconds`. */
static inline float mf_env_coeff_seconds(float seconds)
{
    if (seconds <= 0.0f) return 1.0f;
    float c = 1.0f - expf(-1.0f / (seconds * MOVEFORGE_SAMPLE_RATE));
    return moveforge_clampf(c, 0.0f, 1.0f);
}

static inline void mf_ar_init(mf_ar_t *e)
{
    if (!e) return;
    e->value = 0.0f;
    e->attack_coeff = 1.0f;
    e->release_coeff = 1.0f;
}

static inline void mf_ar_set_times(mf_ar_t *e, float attack_s, float release_s)
{
    if (!e) return;
    e->attack_coeff = mf_env_coeff_seconds(attack_s);
    e->release_coeff = mf_env_coeff_seconds(release_s);
}

static inline float mf_ar_tick(mf_ar_t *e, int gate_open, float sustain)
{
    float target = gate_open ? sustain : 0.0f;
    float c = gate_open ? e->attack_coeff : e->release_coeff;
    e->value += (target - e->value) * c;
    e->value = mf_flush_denorm(e->value);
    return e->value;
}

/* ---------------------------------------------------------------------------
 * Soft clip
 *
 * Rational approximation of tanh: ~6 multiplies, 5 adds and a divide against a
 * libm call. westfold alone makes five tanhf calls per sample.
 *
 * Pade 5/4, chosen by measuring candidates rather than by reputation. Max
 * absolute error 0.00087 over |x| <= 6, monotonic (so it cannot introduce
 * fold-back of its own), and it stays inside full scale across its clamped
 * range. For reference the obvious Pade 3/2 — x(27+x^2)/(27+9x^2) — is off by
 * 0.024 near x = 1.57, which is audible as a different saturation curve, and
 * Pade 7/6 is more accurate but overshoots +-1 without an output clamp.
 * ------------------------------------------------------------------------- */

static inline float mf_tanh_approx(float x)
{
    float c = moveforge_clampf(x, -4.0f, 4.0f);
    float c2 = c * c;
    float num = c * (10395.0f + c2 * (1260.0f + c2 * 21.0f));
    float den = 10395.0f + c2 * (4725.0f + c2 * (210.0f + c2));
    /* Belt and braces: the rational is bounded inside the clamp, but a
     * saturator that can exceed full scale is a clipping bug waiting to happen. */
    return moveforge_clampf(num / den, -1.0f, 1.0f);
}

/* ---------------------------------------------------------------------------
 * Soft limiter
 *
 * Exactly identity below the knee, C1-continuous through it, and asymptotic to
 * +-1 above. Use this instead of mf_tanh_approx where a signal is normally in
 * range and only occasionally overshoots: tanh alters everything it touches,
 * which breaks any "passes audio through unchanged" contract.
 * ------------------------------------------------------------------------- */

#define MF_SOFT_LIMIT_KNEE 0.75f

static inline float mf_soft_limit(float x)
{
    float a = fabsf(x);
    if (a <= MF_SOFT_LIMIT_KNEE) return x;
    const float head = 1.0f - MF_SOFT_LIMIT_KNEE;
    float over = a - MF_SOFT_LIMIT_KNEE;
    float y = MF_SOFT_LIMIT_KNEE + head * (over / (over + head));
    return x < 0.0f ? -y : y;
}

/* ---------------------------------------------------------------------------
 * Triangle wavefolder
 *
 * Reflects about +-1 and repeats with period 4, so it is the identity on
 * [-1, 1] and folds everything beyond back inside. Continuous everywhere (the
 * reflection points are corners, not steps), which a modulo-based folder is
 * not — a wrap produces a full-scale discontinuity and sounds like a fault.
 * ------------------------------------------------------------------------- */

static inline float mf_fold(float x)
{
    float y = x + 1.0f;
    y -= 4.0f * floorf(y * 0.25f);   /* wrap into [0, 4) */
    if (y > 2.0f) y = 4.0f - y;      /* reflect into [0, 2] */
    return y - 1.0f;
}

/* ---------------------------------------------------------------------------
 * Drive — five saturation curves behind one interface
 *
 * This exists so that every engine in a family distorts the same way. Grit is
 * most of what makes a set of drum voices sound like one instrument rather
 * than several, and the fastest way to lose that is for each module to grow
 * its own tanh.
 *
 * Two properties hold for all five curves, and they are what make the control
 * usable rather than merely present:
 *
 *   drive = 0 is clean. Not "nearly clean" — each curve's pre-gain starts
 *   wherever that curve is the identity (0.2 for the tanh-like ones, which is
 *   linear to within 1%; exactly 1.0 for clip and fold, which are identities
 *   on [-1, 1]; 16 bits and no decimation for crush). So the bottom of the
 *   knob is not a dead zone in some modes and a distortion in others.
 *
 *   Output is peak-normalised. `comp` is computed from the curve's own
 *   response to a full-scale input, so turning drive up changes character
 *   without changing level, and A/B-ing curves compares curves rather than
 *   loudness.
 *
 * Coefficients are per-block work; only mf_drive_tick belongs in the sample
 * loop. Same split as mf_svf_t.
 *
 * No oversampling. Clip, fold and crush all alias, and for crush that is the
 * entire point. Whether the other four want a 2x path is a measurement to make
 * against a rendered spectrum, not an assumption to build in — see
 * plans/ballast-kick-engine.md.
 * ------------------------------------------------------------------------- */

typedef enum {
    MF_DRIVE_SOFT = 0,  /* tanh — round, symmetric, odd harmonics        */
    MF_DRIVE_ASYM = 1,  /* biased tanh — even harmonics, tube-ish        */
    MF_DRIVE_CLIP = 2,  /* hard clip — mid-forward and cutting           */
    MF_DRIVE_FOLD = 3,  /* triangle fold — inharmonic, metallic          */
    MF_DRIVE_CRUSH = 4, /* bit + rate reduction — digital breakup        */
    MF_DRIVE_COUNT = 5
} mf_drive_curve_t;

typedef struct {
    int curve;
    float pre;      /* pre-gain into the nonlinearity        */
    float comp;     /* output scaling, peak-normalising      */
    float bias;     /* asym only: operating-point offset     */
    float bias_dc;  /* asym only: tanh(bias), removed        */
    float steps;    /* crush only: quantiser levels          */
    float rate;     /* crush only: sample-and-hold rate, 0..1 */
} mf_drive_coeffs_t;

typedef struct {
    float hold;   /* crush sample-and-hold */
    float phase;  /* crush decimation phase */
} mf_drive_t;

static inline void mf_drive_init(mf_drive_t *d)
{
    if (!d) return;
    d->hold = 0.0f;
    d->phase = 0.0f;
}

/* Exponential interpolation, so the knob is roughly constant in
 * character-per-turn instead of doing everything in its last tenth. */
static inline float mf_drive_gain_(float amount, float lo, float hi)
{
    return lo * powf(hi / lo, moveforge_clampf(amount, 0.0f, 1.0f));
}

static inline void mf_drive_set(mf_drive_coeffs_t *c, int curve, float drive)
{
    if (!c) return;
    float d = moveforge_clampf(drive, 0.0f, 1.0f);
    if (curve < 0 || curve >= MF_DRIVE_COUNT) curve = MF_DRIVE_SOFT;

    c->curve = curve;
    c->pre = 1.0f;
    c->comp = 1.0f;
    c->bias = 0.0f;
    c->bias_dc = 0.0f;
    c->steps = 32768.0f;
    c->rate = 1.0f;

    switch (curve) {
    case MF_DRIVE_SOFT: {
        c->pre = mf_drive_gain_(d, 0.2f, 25.0f);
        c->comp = 1.0f / mf_tanh_approx(c->pre);
        break;
    }
    case MF_DRIVE_ASYM: {
        c->pre = mf_drive_gain_(d, 0.2f, 25.0f);
        c->bias = 0.6f * d;
        c->bias_dc = mf_tanh_approx(c->bias);
        float hi = mf_tanh_approx(c->pre + c->bias) - c->bias_dc;
        float lo = c->bias_dc - mf_tanh_approx(-c->pre + c->bias);
        float peak = (hi > lo) ? hi : lo;
        c->comp = (peak > 1.0e-6f) ? 1.0f / peak : 1.0f;
        break;
    }
    case MF_DRIVE_CLIP:
    case MF_DRIVE_FOLD: {
        /* Both are the identity on [-1, 1], so a pre-gain below 1 would be a
         * dead zone rather than a gentler setting. Start at unity. */
        c->pre = mf_drive_gain_(d, 1.0f, (curve == MF_DRIVE_CLIP) ? 40.0f : 10.0f);
        c->comp = 1.0f;
        break;
    }
    case MF_DRIVE_CRUSH: {
        float bits = 16.0f - 12.0f * d;              /* 16 down to 4      */
        c->steps = powf(2.0f, bits - 1.0f);
        c->rate = powf(1.0f / 16.0f, d);             /* 1x down to 1/16x  */
        break;
    }
    default: break;
    }
}

static inline float mf_drive_tick(mf_drive_t *d, const mf_drive_coeffs_t *c, float x)
{
    switch (c->curve) {
    case MF_DRIVE_SOFT:
        return mf_tanh_approx(x * c->pre) * c->comp;
    case MF_DRIVE_ASYM:
        return (mf_tanh_approx(x * c->pre + c->bias) - c->bias_dc) * c->comp;
    case MF_DRIVE_CLIP:
        return moveforge_clampf(x * c->pre, -1.0f, 1.0f);
    case MF_DRIVE_FOLD:
        return mf_fold(x * c->pre);
    case MF_DRIVE_CRUSH: {
        float q = moveforge_clampf(x, -1.0f, 1.0f);
        q = (float)((int)(q * c->steps + (q >= 0.0f ? 0.5f : -0.5f))) / c->steps;
        d->phase += c->rate;
        if (d->phase >= 1.0f) {
            d->phase -= floorf(d->phase);
            d->hold = q;
        }
        return d->hold;
    }
    default:
        return x;
    }
}

/* ---------------------------------------------------------------------------
 * Noise
 *
 * Integer LCG, full 2^32 period. Never round-trip PRNG state through a float:
 * dustline did, which cost the low 8 bits of state every sample. Measured
 * through the module, its "noise" had an autocorrelation of exactly 1.0 at a lag
 * of 651 samples — a perfectly periodic 67.7 Hz buzz, not noise. With this
 * generator the worst autocorrelation over lags 200..40000 is 0.013.
 * ------------------------------------------------------------------------- */

typedef struct {
    uint32_t state;
} mf_rng_t;

static inline void mf_rng_init(mf_rng_t *r, uint32_t seed)
{
    if (!r) return;
    r->state = seed ? seed : 0x12345678u;
}

static inline uint32_t mf_rng_next_u32(mf_rng_t *r)
{
    r->state = r->state * 1664525u + 1013904223u;
    return r->state;
}

/* Uniform in [-1, 1). Takes the high bits: an LCG's low bits are poor. */
static inline float mf_rng_bipolar(mf_rng_t *r)
{
    int32_t hi = (int32_t)mf_rng_next_u32(r) >> 8;   /* -8388608 .. 8388607 */
    return (float)hi * (1.0f / 8388608.0f);
}

/* ---------------------------------------------------------------------------
 * Monophonic voice allocation with a held-note stack
 *
 * All three sound generators tracked a single `active_note` and cleared the gate
 * whenever a note-off matched it. That drops a still-held note: press A, press
 * B, release B, and the voice goes silent even though A is down. Verified on
 * westfold — gate 0, active_note -1, with A still held.
 *
 * Last-note priority with a stack, which is what a mono synth is expected to do:
 * a new note takes over, and releasing it falls back to whatever is still held.
 * Releasing a note that is not the sounding one changes nothing.
 *
 * The caller decides how to act on a fallback (retrigger the envelope, glide,
 * or just repitch) — this only says which note should be sounding.
 * ------------------------------------------------------------------------- */

#define MF_VOICE_MAX_HELD 16

typedef enum {
    MF_VOICE_UNCHANGED = 0, /* the sounding note did not change */
    MF_VOICE_START,         /* sound *out_note at *out_velocity, gate on */
    MF_VOICE_STOP           /* nothing is held any more, gate off */
} mf_voice_action_t;

typedef struct {
    uint8_t note[MF_VOICE_MAX_HELD];     /* oldest first, newest last */
    float velocity[MF_VOICE_MAX_HELD];
    int count;
} mf_voice_t;

static inline void mf_voice_init(mf_voice_t *v)
{
    if (!v) return;
    v->count = 0;
}

/* The note that should currently be sounding, or -1 if none. */
static inline int mf_voice_current(const mf_voice_t *v)
{
    if (!v || v->count <= 0) return -1;
    return (int)v->note[v->count - 1];
}

static inline void mf_voice_remove_at(mf_voice_t *v, int idx)
{
    for (int i = idx; i < v->count - 1; i++) {
        v->note[i] = v->note[i + 1];
        v->velocity[i] = v->velocity[i + 1];
    }
    v->count--;
}

static inline mf_voice_action_t mf_voice_note_on(mf_voice_t *v, int note, float velocity,
                                                 int *out_note, float *out_velocity)
{
    if (!v || note < 0 || note > 127) return MF_VOICE_UNCHANGED;

    /* Retriggering a note already down moves it to the top rather than
     * stacking a duplicate, so its later note-off cannot leave a ghost entry. */
    for (int i = 0; i < v->count; i++) {
        if (v->note[i] == (uint8_t)note) {
            mf_voice_remove_at(v, i);
            break;
        }
    }
    /* A mono voice with 16 notes held is already pathological; drop the oldest
     * rather than refusing the newest, which is what a player would expect. */
    if (v->count == MF_VOICE_MAX_HELD) mf_voice_remove_at(v, 0);

    v->note[v->count] = (uint8_t)note;
    v->velocity[v->count] = moveforge_clampf(velocity, 0.0f, 1.0f);
    v->count++;

    if (out_note) *out_note = note;
    if (out_velocity) *out_velocity = v->velocity[v->count - 1];
    return MF_VOICE_START;
}

static inline mf_voice_action_t mf_voice_note_off(mf_voice_t *v, int note,
                                                  int *out_note, float *out_velocity)
{
    if (!v || v->count <= 0) return MF_VOICE_UNCHANGED;

    int idx = -1;
    for (int i = v->count - 1; i >= 0; i--) {
        if (v->note[i] == (uint8_t)note) {
            idx = i;
            break;
        }
    }
    if (idx < 0) return MF_VOICE_UNCHANGED;   /* not held; ignore */

    const int was_sounding = (idx == v->count - 1);
    mf_voice_remove_at(v, idx);

    if (!was_sounding) return MF_VOICE_UNCHANGED;
    if (v->count == 0) return MF_VOICE_STOP;

    if (out_note) *out_note = (int)v->note[v->count - 1];
    if (out_velocity) *out_velocity = v->velocity[v->count - 1];
    return MF_VOICE_START;
}

static inline mf_voice_action_t mf_voice_all_off(mf_voice_t *v)
{
    if (!v) return MF_VOICE_UNCHANGED;
    v->count = 0;
    return MF_VOICE_STOP;
}

/* ---------------------------------------------------------------------------
 * Tempo
 *
 * Division tables stay per-module: their index order is part of each module's
 * published parameter contract (trail has 10 entries, lobber 6, in different
 * orders), so unifying them would silently remap saved presets.
 * ------------------------------------------------------------------------- */

static inline int mf_beats_to_samples(float beats, float bpm)
{
    if (bpm < 1.0f) bpm = 1.0f;
    if (beats < 0.0f) beats = 0.0f;
    float samples = (60.0f / bpm) * beats * MOVEFORGE_SAMPLE_RATE;
    if (samples > 2.0e9f) samples = 2.0e9f;
    return (int)samples;
}

#endif

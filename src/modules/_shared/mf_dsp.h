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
 *   mf_decay_t           two-stage exp/linear decay, crossfaded by one control
 *   mf_tanh_approx       rational tanh, ~7 ops instead of a libm call
 *   mf_fold              triangle wavefolder
 *   mf_drive_t           five saturation curves behind one interface
 *   mf_reson_t           two-pole resonator taking a T60 directly
 *   mf_rng_t             integer LCG noise source
 *   mf_exciter_t         noise grains, density and burst structure on one axis
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
 * Note-gated ADSR envelope
 *
 * The four-stage envelope with its own note gate, shared by every module that
 * has one. A module owns what the envelope drives; this owns the shape, the
 * stage machine and which notes are down.
 *
 * Each stage aims past where it is going, as a share of the distance it has to
 * cross, and snaps on arrival. A stage that only approached its destination
 * would never reach it, and the seconds on the encoder would name a time
 * constant rather than a duration. A host draws the stages against one axis by
 * their declared seconds, so the seconds have to be what the stage takes.
 *
 * Notes are held as a bitmask, one bit per MIDI note. A count would drift on an
 * unmatched note-off and leave the gate stuck open; a bitmask cannot.
 *
 * Coefficients are per-block work: call mf_adsr_set_times() outside the loop.
 * ------------------------------------------------------------------------- */

/*
 * MF_ADSR_IDLE is a past tense: nothing returns to it. A completed release
 * stays in MF_ADSR_RELEASE with its value at zero, which is what lets a caller
 * read "this is the first note this instance has ever had" off the stage. A
 * future edit that resets the stage to IDLE when the release finishes would
 * silently make every note after the first look like the first.
 */
enum {
    MF_ADSR_IDLE = 0,
    MF_ADSR_ATTACK,
    MF_ADSR_DECAY,
    MF_ADSR_RELEASE
};

#define MF_ADSR_OVERSHOOT 0.2f
#define MF_ADSR_TAU_SCALE 1.7917595f /* ln(1 + 1 / MF_ADSR_OVERSHOOT) */
#define MF_ADSR_ATTACK_TARGET (1.0f + MF_ADSR_OVERSHOOT)
#define MF_ADSR_RELEASE_TARGET (-MF_ADSR_OVERSHOOT)

typedef struct {
    int stage;
    float value;
    uint32_t held[4];
    float attack_coeff;
    float decay_coeff;
    float release_coeff;
    float coeff_attack_seconds;
    float coeff_decay_seconds;
    float coeff_release_seconds;
} mf_adsr_t;

static inline void mf_adsr_init(mf_adsr_t *e)
{
    if (!e) return;
    e->stage = MF_ADSR_IDLE;
    e->value = 0.0f;
    e->held[0] = e->held[1] = e->held[2] = e->held[3] = 0u;
    e->attack_coeff = 1.0f;
    e->decay_coeff = 1.0f;
    e->release_coeff = 1.0f;
    /* Nothing has been asked for yet, so no coefficient matches its time. */
    e->coeff_attack_seconds = -1.0f;
    e->coeff_decay_seconds = -1.0f;
    e->coeff_release_seconds = -1.0f;
}

/* Recomputes only the stages whose time moved. This runs per block, and an
 * expf per sample is the one thing an envelope cannot afford. */
static inline void mf_adsr_set_times(mf_adsr_t *e, float attack_s,
                                     float decay_s, float release_s)
{
    if (!e) return;
    if (attack_s != e->coeff_attack_seconds) {
        e->coeff_attack_seconds = attack_s;
        e->attack_coeff = mf_env_coeff_seconds(attack_s / MF_ADSR_TAU_SCALE);
    }
    if (decay_s != e->coeff_decay_seconds) {
        e->coeff_decay_seconds = decay_s;
        e->decay_coeff = mf_env_coeff_seconds(decay_s / MF_ADSR_TAU_SCALE);
    }
    if (release_s != e->coeff_release_seconds) {
        e->coeff_release_seconds = release_s;
        e->release_coeff = mf_env_coeff_seconds(release_s / MF_ADSR_TAU_SCALE);
    }
}

static inline int mf_adsr_any_held(const mf_adsr_t *e)
{
    return (e->held[0] | e->held[1] | e->held[2] | e->held[3]) != 0u;
}

/* Returns 1 when this note starts the envelope from idle, so a caller that
 * has to hand something over on the first note can see it. */
static inline int mf_adsr_note_on(mf_adsr_t *e, int note)
{
    int first;
    if (!e || note < 0 || note > 127) return 0;
    first = !mf_adsr_any_held(e) && e->stage == MF_ADSR_IDLE;
    e->held[note >> 5] |= 1u << (note & 31);
    e->stage = MF_ADSR_ATTACK;
    return first;
}

static inline void mf_adsr_note_off(mf_adsr_t *e, int note)
{
    if (!e || note < 0 || note > 127) return;
    e->held[note >> 5] &= ~(1u << (note & 31));
    if (!mf_adsr_any_held(e)) e->stage = MF_ADSR_RELEASE;
}

/* Releases every held note, so a panic cannot leave the gate open. */
static inline void mf_adsr_all_notes_off(mf_adsr_t *e)
{
    if (!e) return;
    e->held[0] = e->held[1] = e->held[2] = e->held[3] = 0u;
    if (e->stage != MF_ADSR_IDLE) e->stage = MF_ADSR_RELEASE;
}

/* A note opens and closes the gate. Anything that is not a note is ignored.
 * Returns 1 when the message started the envelope from idle. */
static inline int mf_adsr_handle_midi(mf_adsr_t *e, int status, int d1, int d2)
{
    int kind;
    if (!e || d1 < 0 || d1 > 127) return 0;
    kind = status & 0xF0;
    if (kind == 0x90 && d2 > 0) return mf_adsr_note_on(e, d1);
    if (kind == 0x80 || (kind == 0x90 && d2 == 0)) mf_adsr_note_off(e, d1);
    return 0;
}

static inline float mf_adsr_tick(mf_adsr_t *e, float sustain)
{
    switch (e->stage) {
    case MF_ADSR_ATTACK:
        e->value += (MF_ADSR_ATTACK_TARGET - e->value) * e->attack_coeff;
        if (e->value >= 1.0f) {
            e->value = 1.0f;
            e->stage = MF_ADSR_DECAY;
        }
        break;
    case MF_ADSR_DECAY: {
        /* Aiming past sustain only on the way down. A sustain raised under a
         * held note is approached from below, where an ordinary one-pole
         * already arrives from the correct side. */
        int falling = e->value > sustain;
        float target = falling
            ? sustain - MF_ADSR_OVERSHOOT * (1.0f - sustain)
            : sustain;
        e->value += (target - e->value) * e->decay_coeff;
        if (falling && e->value < sustain) e->value = sustain;
        break;
    }
    default:
        e->value += (MF_ADSR_RELEASE_TARGET - e->value) * e->release_coeff;
        if (e->value < 0.0f) e->value = 0.0f;
        break;
    }
    e->value = mf_flush_denorm(e->value);
    return moveforge_clampf(e->value, 0.0f, 1.0f);
}

/* ---------------------------------------------------------------------------
 * Two-stage decay envelope
 *
 * An exponential and a linear decay of the same length, run in parallel and
 * crossfaded by `shape`. Two adds and a multiply per sample against a powf, and
 * exact at both ends: 0 is a pure exponential, 1 a pure linear ramp. Percussion
 * wants both — an exponential fades, a linear one holds and then stops, and the
 * difference is most of what separates a tom from a clap.
 *
 * Lifted from ballast, which had it inline as an `amp_exp`/`amp_lin` pair. It was
 * left un-extracted until a second engine needed the same thing.
 *
 * ### The taper, and a claim that did not survive measurement
 *
 * plans/perc-engine-brief.md says to retaper this because "`shape` puts ~70% of
 * its effect in its first tenth". Measured against a 0.5 s decay, it does not:
 *
 *   metric                                      first tenth of the knob
 *   time to fall 12 dB  (perceived length)                        6.8%
 *   time to fall 20 dB  (perceived length)                       18.4%
 *   level at a fixed time, in dB, at 0.25 decay                  19.4%
 *   level at a fixed time, in dB, at 0.875 decay                 45.9%
 *
 * An even control would be 10%. So the effect is front-loaded, and increasingly so
 * the deeper into the tail you look — but the worst honest reading is 46%, not 70%,
 * and no reading reproduces 70%. That matters because the strong correction the
 * brief's number implies (a square or a cube) overshoots badly: knob^2 leaves only
 * 1.5% of the 20 dB length range in the first tenth and 0.6% of the 12 dB range,
 * which is a dead zone rather than a fix.
 *
 * MF_DECAY_SHAPE_TAPER is 1.25, picked from the sweep as the exponent that makes
 * the 20 dB length control almost exactly even (18.4% -> 9.3%, and its
 * largest-step-to-smallest-step ratio 12.6 -> 8.8) and improves every tail-level
 * reading, while still moving the control a real 26 ms over its first tenth. 1.5
 * was the best on the 20 dB metric alone (6.8) but over-corrects to 4.9% and only
 * moves 14 ms, and it makes the 12 dB metric worse than doing nothing.
 *
 * Set to 1.0 for ballast's original linear crossfade.
 * ------------------------------------------------------------------------- */

#define MF_DECAY_SHAPE_TAPER 1.25f

typedef struct {
    float exp_coeff; /* per-sample multiplier for the exponential stage */
    float lin_step;  /* per-sample decrement for the linear stage       */
    float shape_w;   /* tapered crossfade weight, 0 = exp, 1 = linear   */
} mf_decay_coeffs_t;

typedef struct {
    float exp_v;
    float lin_v;
} mf_decay_t;

static inline void mf_decay_init(mf_decay_t *e)
{
    if (!e) return;
    e->exp_v = 0.0f;
    e->lin_v = 0.0f;
}

/* Both stages to full. Call on note-on. */
static inline void mf_decay_trigger(mf_decay_t *e)
{
    if (!e) return;
    e->exp_v = 1.0f;
    e->lin_v = 1.0f;
}

/* Collapse to zero. Deliberately not a fade: the caller's declick ramp carries the
 * output down, which is what ballast does on note-off. */
static inline void mf_decay_release(mf_decay_t *e)
{
    if (!e) return;
    e->exp_v = 0.0f;
    e->lin_v = 0.0f;
}

/* `decay_s` is the -60 dB time of the exponential stage and the zero-crossing time
 * of the linear one, so the two are the same length at every shape. */
static inline void mf_decay_set(mf_decay_coeffs_t *c, float decay_s, float shape)
{
    if (!c) return;
    float d = (decay_s < 0.0005f) ? 0.0005f : decay_s;
    c->exp_coeff = expf(-6.9078f / (d * MOVEFORGE_SAMPLE_RATE));
    c->lin_step = 1.0f / (d * MOVEFORGE_SAMPLE_RATE);
    c->shape_w = powf(moveforge_clampf(shape, 0.0f, 1.0f), MF_DECAY_SHAPE_TAPER);
}

static inline float mf_decay_tick(mf_decay_t *e, const mf_decay_coeffs_t *c)
{
    e->exp_v = mf_flush_denorm(e->exp_v * c->exp_coeff);
    e->lin_v -= c->lin_step;
    if (e->lin_v < 0.0f) e->lin_v = 0.0f;
    return e->exp_v + (e->lin_v - e->exp_v) * c->shape_w;
}

/* True once both stages are spent. The linear stage reaches exact zero, so this is
 * a real end rather than an asymptote — include it in a voice's idle test or the
 * exponential stage alone will keep the voice alive forever. */
static inline int mf_decay_is_idle(const mf_decay_t *e, float eps)
{
    return e->exp_v < eps && e->lin_v <= 0.0f;
}

/* ---------------------------------------------------------------------------
 * Two-pole resonator, parameterised by T60
 *
 * A single mode of a struck object: one complex pole pair, hit with an impulse or
 * fed noise. Impulse-excited it is a decaying sinusoid; noise-excited it is a noise
 * band. Same coefficients either way — which is what collapses "struck modal body"
 * and "sustained metallic cluster" into one primitive, and why a percussion engine
 * built on these needs no oscillators.
 *
 * ### Why not the SVF
 *
 * mf_svf_t is bandpass-capable and unconditionally stable, so it looks like the
 * obvious partial. It cannot do this job, because its resonance is normalised and
 * capped at MF_SVF_Q_MAX. Measured T60 of its bandpass output at resonance = 1:
 *
 *     100 Hz   546 ms      1 kHz    55 ms      8 kHz   8.7 ms
 *     200 Hz   273 ms      4 kHz    15 ms
 *
 * A ride cymbal needs seconds at 8 kHz. No knob mapping fixes a 8.7 ms ceiling, so
 * the partial bank needs a primitive that takes the decay time it is asked for.
 *
 * ### Accuracy
 *
 * `r = exp(-6.9078 / (T60 * sr))` puts the pole radius exactly where a 60 dB decay
 * over T60 requires. Measured error across 100 Hz - 8 kHz and 5 ms - 4 s: within
 * 1.3% for T60 >= 50 ms, and within 4.4% at 5 ms, where the measurement window is
 * itself longer than the decay.
 *
 * `b0 = sin(w)` normalises the impulse response to unit peak — asymptotically.
 * Measured peak is 0.97-1.00 once the resonator has ten cycles or so to ring in
 * (500 ms at 100 Hz, 50 ms at 1 kHz) and falls short below that: 0.167 for 5 ms at
 * 100 Hz, which is half a cycle and physically cannot reach full swing. It never
 * exceeds 1, which is the property gain staging needs.
 *
 * ### Skipping is the caller's job
 *
 * mf_reson_set clamps its frequency below Nyquist as a backstop, but a partial bank
 * must *skip* out-of-range partials rather than let them be clamped: a clamped
 * partial still sounds, at the wrong pitch, and folds a rising `tune` sweep into
 * partials that move downward. Use mf_reson_audible as the gate.
 * ------------------------------------------------------------------------- */

#define MF_RESON_T60_MIN 0.001f
#define MF_RESON_T60_MAX 20.0f
/* Above this fraction of the sample rate a partial is not worth rendering. */
#define MF_RESON_MAX_HZ_FRACTION 0.45f
/* Below this, relative to the loudest partial in the bank, it is inaudible. */
#define MF_RESON_MIN_GAIN 0.001f   /* -60 dB */

typedef struct {
    float a1; /*  2 r cos(w) */
    float a2; /* -r^2        */
    float b0; /*  sin(w)     */
} mf_reson_coeffs_t;

typedef struct {
    float y1;
    float y2;
} mf_reson_t;

static inline void mf_reson_init(mf_reson_t *s)
{
    if (!s) return;
    s->y1 = 0.0f;
    s->y2 = 0.0f;
}

/* Whether a partial at `hz` with relative `gain` is worth running at all. Muting
 * rather than folding is what keeps a `tune` sweep from generating partials that
 * move down as the knob goes up. */
static inline int mf_reson_audible(float hz, float gain)
{
    return hz > 1.0f
        && hz < MOVEFORGE_SAMPLE_RATE * MF_RESON_MAX_HZ_FRACTION
        && gain > MF_RESON_MIN_GAIN;
}

static inline void mf_reson_set(mf_reson_coeffs_t *c, float hz, float t60_s)
{
    if (!c) return;
    float f = moveforge_clampf(hz, 1.0f, MOVEFORGE_SAMPLE_RATE * MF_RESON_MAX_HZ_FRACTION);
    float t60 = moveforge_clampf(t60_s, MF_RESON_T60_MIN, MF_RESON_T60_MAX);
    float r = expf(-6.9078f / (t60 * MOVEFORGE_SAMPLE_RATE));
    /* r < 1 strictly: at T60 = 20 s the float nearest exp(-7.8e-6) rounds to
     * 0.99999219, but a longer T60 would round to 1.0 and the mode would ring
     * forever rather than decay. The clamp above is what prevents that. */
    float w = MOVEFORGE_TWO_PI * f / MOVEFORGE_SAMPLE_RATE;
    c->a1 = 2.0f * r * cosf(w);
    c->a2 = -r * r;
    c->b0 = sinf(w);
}

static inline float mf_reson_tick(mf_reson_t *s, const mf_reson_coeffs_t *c, float x)
{
    float y = c->b0 * x + c->a1 * s->y1 + c->a2 * s->y2;
    s->y2 = s->y1;
    s->y1 = mf_flush_denorm(y);
    return y;
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
 * Excitation
 *
 * What hits the resonator. Ballast folds its click into `punch` and hard-codes a
 * 1500 Hz highpass on it, which is right for a kick, where the click is a detail on
 * top of an oscillator. An engine that is *entirely* excitation needs the noise's
 * time structure to be first-class instead, because that is where the difference
 * between a hat, a shaker and a clap lives — not in the resonator, which is the
 * same in all three.
 *
 * One control, `strike`, bipolar around 0.5. The axis is **how the hit's energy is
 * distributed in time**: many small stochastic events on the left, one clean event
 * at the centre, few large deliberate ones on the right. With s = (strike - 0.5)*2:
 *
 *   s = -1   one impulse per ~500 samples, 120 ms envelope   shaker, cabasa, wash
 *   s =  0   continuous noise, 1.5 ms envelope               one strike
 *   s = +1   four bursts 6 ms apart                          clap, ratchet
 *
 * ### Grains are stochastic, not periodic
 *
 * "Decimate to one impulse per N samples" invites a counter. A periodic impulse
 * train is a tone — at N = 500 that is a buzz at 88 Hz, which is precisely not a
 * shaker. Each sample instead draws against a threshold, so spacing is geometric
 * and the result has no pitch of its own.
 *
 * ### Output is bounded; level across the axis is not flat, and is not fixed here
 *
 * Grains are unit-amplitude, so the output stays inside +-1 like every other block
 * here (measured worst case 0.994 over 21 strike values x 40 seeds). That is the
 * invariant that lets blocks compose without each one publishing a private gain
 * contract.
 *
 * What is *not* offered is a scalar that flattens level across the axis, because
 * there isn't one. The obvious candidate — a per-grain gain of sqrt(period), on the
 * reasoning that N overlapping rings sum to sqrt(N) — was implemented and measured,
 * and it is wrong twice over. It makes the exciter's own peak climb 17 dB (0.94 to
 * 6.7), and it does not flatten what it is meant to: peak ring of a 2 kHz / 400 ms
 * resonator fed by this exciter, across strike 0.5 down to 0.0,
 *
 *     raw               0.96  4.71  1.94  2.78  2.32  0.87
 *     x sqrt(period)    0.96  8.77  6.74 17.94 27.84 19.49
 *
 * so the "compensation" turns a 15 dB spread into a 30 dB one. The reason is that
 * `strike` moves two things at once: grains get sparser *and* the envelope gets
 * longer, so the number of grains in one hit peaks in the middle of the axis (~360
 * at strike 0.4, ~70 at 0.5, ~14 at 0.0) rather than falling monotonically.
 *
 * Excitation level is therefore a per-voice calibration problem for the module, not
 * a property of this block. The numbers above are the starting point for it.
 * ------------------------------------------------------------------------- */

#define MF_EXCITER_MAX_BURSTS 3
/* Sparsest grain spacing, in samples, at strike = 0. */
#define MF_EXCITER_MAX_PERIOD 500.0f

typedef struct {
    float env_coeff;                          /* per-sample envelope decay      */
    uint32_t grain_threshold;                 /* rng draw below this -> a grain  */
    int burst_count;                          /* extra bursts after the first   */
    int burst_spacing;                        /* samples between bursts         */
    float burst_level[MF_EXCITER_MAX_BURSTS];
} mf_exciter_coeffs_t;

typedef struct {
    mf_rng_t rng;
    float env;
    int bursts_left;     /* extra bursts still to fire */
    int burst_countdown; /* samples until the next one */
} mf_exciter_t;

static inline void mf_exciter_init(mf_exciter_t *e, uint32_t seed)
{
    if (!e) return;
    mf_rng_init(&e->rng, seed);
    e->env = 0.0f;
    e->bursts_left = 0;
    e->burst_countdown = 0;
}

/* `strike` is 0..1, bipolar around 0.5. Across the axis:
 *
 *     strike       0.50   0.40   0.30   0.20   0.10   0.00
 *     grain gap     1.0    3.5   12.0   41.4  143.0  500.0  samples, by design
 *     envelope      1.6   27.7   56.7   77.4  106.9  122.0  ms to -40 dB, measured
 *     bursts          0      0      0      0      0      0
 *
 * and on the other half, where density and envelope stay put and the structure
 * comes from the burst scheduler instead:
 *
 *     strike       0.50   0.60   0.70   0.80   0.90   1.00
 *     bursts          0      1      2      2      3      3  extra hits
 *     spacing      25.0   21.2   17.4   13.6    9.8    6.0  ms apart
 *
 * The measured gap standard deviation tracks its mean to within 5% (e.g. 42.7 and
 * 42.6 at strike 0.2), which is the signature of geometric spacing — a periodic
 * decimator would read 0. */
/* Pass as `max_s` to leave the excitation unbounded by the caller's event. */
#define MF_EXCITER_UNBOUNDED 1.0e9f

/* How `max_s` is divided between the two things that can outlast it. The envelope
 * figure is a time to -40 dB, so its -60 dB tail runs about 1.7x longer, and the
 * bursts land on top of that rather than instead of it — capping each at `max_s`
 * separately therefore overshoots by 2-3x. These two split the budget so the sum
 * lands near it. Their values are measured rather than derived: see the tables in
 * mf_exciter_set. */
#define MF_EXCITER_ENV_FRACTION 0.35f
#define MF_EXCITER_BURST_FRACTION 0.40f

/* `max_s` is the longest the excitation may last — the caller's own event length,
 * normally the voice's T60.
 *
 * Without it, `strike` is a second decay control that silently outranks the first.
 * Measured on swarf's conga at `mat` 0.5, asking for decay times from 10 ms to
 * 101 ms and reading what came out:
 *
 *     strike        0.00   0.25   0.44   0.50   0.52   0.70   0.86
 *     floor (ms)    >6000    100     40     50     55     55     70
 *
 * — every request shorter than the floor produced the floor instead, which is the
 * whole hat, click and rim range, and at strike 0 the voice never reached -60 dB at
 * any decay setting at all. Two separate mechanisms, one on each half of the axis:
 * below 0.5 the grain envelope stretches to 122 ms, above it the burst scheduler
 * spreads hits out to 75 ms. Both now compress to fit inside `max_s`.
 *
 * The cap does nothing wherever there is a tail to rattle into — above ~100 ms of
 * decay the measured ratios were already 0.98-1.04 and are untouched — so a long
 * shaker or a maraca still lasts as long as `strike` asks. It only stops a 10 ms
 * hit from carrying a 122 ms excitation. */
static inline void mf_exciter_set(mf_exciter_coeffs_t *c, float strike, float max_s)
{
    if (!c) return;
    float s = (moveforge_clampf(strike, 0.0f, 1.0f) - 0.5f) * 2.0f;
    float cap = (max_s > 0.0f) ? max_s : MF_EXCITER_UNBOUNDED;

    /* Envelope lengthens as the grains spread out: a rattle is a long sprinkle of
     * small events, a strike is one short broadband one. */
    float env_s = (s < 0.0f) ? 0.0015f - s * 0.1185f : 0.0015f;
    float env_cap = cap * MF_EXCITER_ENV_FRACTION;
    float squeeze = 1.0f;
    if (env_s > env_cap) {
        squeeze = env_cap / env_s;
        env_s = env_cap;
    }
    if (env_s < 0.0002f) env_s = 0.0002f;
    c->env_coeff = expf(-4.0f / (env_s * MOVEFORGE_SAMPLE_RATE));

    /* Density: geometric in s so the control is even, rather than spending its
     * whole audible range in the last tenth.
     *
     * Squeezed by however much the envelope was, because shortening the window
     * without tightening the spacing does not compress a rattle, it *empties* one.
     * At strike 0 the grains are 500 samples apart (88 Hz) — bounding that voice to
     * a 19 ms decay leaves a 6.6 ms window, which more often than not contains no
     * grain at all and the hit is silent. Scaling both together keeps a rattle a
     * rattle and only makes it faster. */
    float period = (s < 0.0f) ? powf(MF_EXCITER_MAX_PERIOD, -s) : 1.0f;
    period *= squeeze;
    c->grain_threshold = (period <= 1.0f)
        ? 0xFFFFFFFFu
        : (uint32_t)(4294967295.0f / period);

    /* Bursts fade in by *level*, not by count, or the knob steps audibly as each
     * one appears. Spacing tightens from a flam to a ratchet. */
    c->burst_count = 0;
    for (int k = 0; k < MF_EXCITER_MAX_BURSTS; k++) {
        float fade = moveforge_clampf(s * 3.0f - (float)k, 0.0f, 1.0f);
        /* Each burst ~2 dB below the one before it. */
        c->burst_level[k] = fade * powf(0.794f, (float)(k + 1));
        if (c->burst_level[k] > 0.0f) c->burst_count = k + 1;
    }

    /* Spacing after the count, because what has to fit inside `max_s` is the span
     * the last burst lands at, not one gap. Scaled rather than truncated so a
     * bounded ratchet stays an evenly spaced ratchet. */
    float spacing_s = 0.025f - 0.019f * ((s > 0.0f) ? s : 0.0f);
    if (c->burst_count > 0) {
        float span = spacing_s * (float)c->burst_count;
        float span_cap = cap * MF_EXCITER_BURST_FRACTION;
        if (span > span_cap) spacing_s *= span_cap / span;
    }
    c->burst_spacing = (int)(spacing_s * MOVEFORGE_SAMPLE_RATE);
    /* Zero would fire every burst on consecutive samples via the `--countdown <= 0`
     * test, collapsing a ratchet into one hit. */
    if (c->burst_spacing < 1) c->burst_spacing = 1;
}

/* Start a hit. Snap, not ramp: this is called on note-on. */
static inline void mf_exciter_trigger(mf_exciter_t *e, const mf_exciter_coeffs_t *c)
{
    if (!e || !c) return;
    e->env = 1.0f;
    e->bursts_left = c->burst_count;
    e->burst_countdown = c->burst_spacing;
}

static inline void mf_exciter_release(mf_exciter_t *e)
{
    if (!e) return;
    e->env = 0.0f;
    e->bursts_left = 0;
}

static inline float mf_exciter_tick(mf_exciter_t *e, const mf_exciter_coeffs_t *c)
{
    if (e->bursts_left > 0 && --e->burst_countdown <= 0) {
        /* Clamped because `strike` can move mid-hit and shrink burst_count below
         * the number still pending, which would index behind the array. */
        int idx = c->burst_count - e->bursts_left;
        if (idx < 0) idx = 0;
        if (idx >= MF_EXCITER_MAX_BURSTS) idx = MF_EXCITER_MAX_BURSTS - 1;
        /* Raise the envelope to the new burst's level rather than replacing it:
         * assignment would cut the previous burst's tail short whenever the new
         * one is quieter, which is every burst after the first. */
        float level = c->burst_level[idx];
        if (level > e->env) e->env = level;
        e->bursts_left--;
        e->burst_countdown = c->burst_spacing;
    }

    float grain = 0.0f;
    if (mf_rng_next_u32(&e->rng) <= c->grain_threshold) {
        grain = mf_rng_bipolar(&e->rng);
    }

    float out = grain * e->env;
    e->env = mf_flush_denorm(e->env * c->env_coeff);
    return out;
}

/* A pending burst counts as active: early-outing between the hits of a clap would
 * drop the rest of it. */
static inline int mf_exciter_is_idle(const mf_exciter_t *e, float eps)
{
    return e->env < eps && e->bursts_left <= 0;
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

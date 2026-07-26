#ifndef MOVEFORGE_MODULES_SHARED_MF_DSP_H
#define MOVEFORGE_MODULES_SHARED_MF_DSP_H

/* Shared DSP building blocks.
 *
 * Blocks a module would otherwise hand-roll. Everything here is header-only,
 * C11, allocation-free and safe to call from the audio thread.
 *
 * The rule this file exists to enforce: a module author should never be
 * hand-deriving a filter topology's stability condition. See
 * plans/harden-dsp-pipeline.md for the bug that motivated it.
 *
 * Currently: denormal flush, state-variable filter.
 * Phase 4 of the plan adds the smoother, envelope, DC blocker, tanh
 * approximation, PRNG, beats->samples and voice/note-stack helpers. */

#include <math.h>

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
    c->g = tanf((float)M_PI * fc / MOVEFORGE_SAMPLE_RATE);
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

#endif

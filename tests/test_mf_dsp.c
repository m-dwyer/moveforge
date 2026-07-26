/* Tests for the shared DSP blocks in src/modules/_shared/mf_dsp.h.
 *
 * These are module-independent: they test the building block, so a module's own
 * test file can assert how it *wires* the block up rather than re-deriving the
 * block's properties. */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "modules/_shared/mf_dsp.h"

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static float absf_local(float x) {
    return x < 0.0f ? -x : x;
}

/* Steady-state peak gain of the lowpass output, swept across input frequency. */
static float svf_peak_gain_db(float cutoff_hz, float resonance) {
    mf_svf_coeffs_t c;
    float best = 0.0f;
    mf_svf_set(&c, cutoff_hz, resonance);

    for (float ft = 40.0f; ft < 18000.0f; ft *= 1.04f) {
        mf_svf_t s;
        float peak = 0.0f;
        mf_svf_init(&s);
        for (int i = 0; i < 16000; i++) {
            mf_svf_tick(&s, &c, sinf(MOVEFORGE_TWO_PI * ft * (float)i / MOVEFORGE_SAMPLE_RATE));
            if (i > 9000 && absf_local(s.lp) > peak) peak = absf_local(s.lp);
        }
        if (peak > best) best = peak;
    }
    return 20.0f * log10f(best);
}

static void test_svf_is_unconditionally_stable(void) {
    /* The whole point of the TPT/ZDF form: no (cutoff, resonance) pair blows up,
     * including both at maximum. The Chamberlin form this replaced needed both
     * fq < 2 and f^2 + 2fq < 4, and violating the second produced NaN. */
    for (int ci = 0; ci <= 40; ci++) {
        for (int ri = 0; ri <= 20; ri++) {
            float cutoff_hz = 10.0f + (float)ci * 500.0f;
            float resonance = (float)ri / 20.0f;
            mf_svf_coeffs_t c;
            mf_svf_t s;
            mf_svf_set(&c, cutoff_hz, resonance);
            mf_svf_init(&s);
            for (int i = 0; i < 20000; i++) {
                /* Full-scale square: worst case for a resonant filter. */
                mf_svf_tick(&s, &c, (i % 64) < 32 ? 1.0f : -1.0f);
                if (!isfinite(s.lp) || !isfinite(s.bp) || !isfinite(s.hp)) {
                    fprintf(stderr, "FAIL: svf non-finite at cutoff=%.0fHz resonance=%.2f sample=%d\n",
                            cutoff_hz, resonance, i);
                    exit(1);
                }
            }
        }
    }
}

static void test_svf_resonance_direction_and_evenness(void) {
    /* Peak gain must rise monotonically with the resonance input, and do so
     * reasonably evenly — a control whose bottom half is inaudible is the same
     * usability bug as one that runs backwards.
     *
     * A lowpass has no resonant peak at all until Q > 1/sqrt(2), so the bottom
     * of the range is legitimately flat and only the region above it can be
     * held to an evenness bound. */
    const float fc = 2146.0f;
    const int steps = 8;
    const int resonant_from = 2; /* r >= 0.25, where Q has passed 1/sqrt(2) */
    float db[9];
    float min_step = 1.0e9f;
    float max_step = 0.0f;

    for (int i = 0; i <= steps; i++) {
        db[i] = svf_peak_gain_db(fc, (float)i / (float)steps);
        if (i > 0) require_true(db[i] > db[i - 1], "svf peak gain rises with resonance");
    }

    for (int i = resonant_from + 1; i <= steps; i++) {
        float step = db[i] - db[i - 1];
        if (step < min_step) min_step = step;
        if (step > max_step) max_step = step;
    }

    require_true(db[0] < 0.5f, "svf is flat at zero resonance");
    require_true(db[steps] > 20.0f, "svf reaches a strong resonant peak at maximum");
    require_true(min_step > 1.0f, "every step in the resonant region is audible");
    require_true(max_step < min_step * 2.0f,
                 "svf resonance control is roughly even in dB per turn");
}

static void test_svf_peak_tracks_cutoff(void) {
    mf_svf_coeffs_t c;
    mf_svf_set(&c, 1000.0f, 0.9f);
    float g_low = c.g;
    mf_svf_set(&c, 8000.0f, 0.9f);
    require_true(c.g > g_low, "svf g rises with cutoff");

    /* Cutoff is clamped below Nyquist, so an out-of-range request stays finite. */
    mf_svf_set(&c, 1.0e6f, 1.0f);
    require_true(isfinite(c.g) && isfinite(c.a1) && c.g > 0.0f, "svf clamps absurd cutoff");
    mf_svf_set(&c, -50.0f, -1.0f);
    require_true(isfinite(c.g) && c.g > 0.0f && c.k > 0.0f, "svf clamps negative cutoff and resonance");
}

static void test_svf_damping_mapping(void) {
    float k0 = mf_svf_damping_from_resonance(0.0f);
    float k1 = mf_svf_damping_from_resonance(1.0f);
    require_true(k0 > k1, "damping falls as resonance rises");
    require_true(absf_local(k0 - 1.0f / MF_SVF_Q_MIN) < 1e-4f, "resonance 0 maps to Q min");
    require_true(absf_local(k1 - 1.0f / MF_SVF_Q_MAX) < 1e-4f, "resonance 1 maps to Q max");
    /* Out-of-range inputs are clamped, not extrapolated into instability. */
    require_true(mf_svf_damping_from_resonance(-1.0f) == k0, "resonance clamps low");
    require_true(mf_svf_damping_from_resonance(2.0f) == k1, "resonance clamps high");
}

static void test_flush_denorm(void) {
    require_true(mf_flush_denorm(1.0e-30f) == 0.0f, "tiny positive flushes to zero");
    require_true(mf_flush_denorm(-1.0e-30f) == 0.0f, "tiny negative flushes to zero");
    require_true(mf_flush_denorm(0.5f) == 0.5f, "normal value passes through");
    require_true(mf_flush_denorm(-0.5f) == -0.5f, "normal negative passes through");
}

int main(void) {
    test_flush_denorm();
    test_svf_damping_mapping();
    test_svf_peak_tracks_cutoff();
    test_svf_is_unconditionally_stable();
    test_svf_resonance_direction_and_evenness();
    printf("mf_dsp shared block tests passed\n");
    return 0;
}

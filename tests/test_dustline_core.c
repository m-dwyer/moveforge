#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "dustline_core.h"

#define FRAMES 4096

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static float absf_local(float x) {
    return x < 0.0f ? -x : x;
}

/* Render a full note lifecycle at one point in parameter space and report the
 * peak. Returns -1 if anything non-finite or out of range appeared.
 *
 * Filter stability is a property of the whole (cutoff, resonance) plane, not of
 * any single point, so the caller sweeps. This is the check that was missing
 * when two shipped presets sat in a divergent region for months: the old test
 * probed cutoff=0.72 at the default resonance 0.18, which was stable, while
 * cutoff=0.70/resonance=0.56 ("Air Noise") and cutoff=0.62/resonance=0.64
 * ("Glass Keys") both blew up to NaN — and NaN renders as digital silence
 * through moveforge_float_to_i16, so it looked like a quiet preset. */
static float sweep_point(float cutoff, float resonance, float drive, float noise) {
    dustline_core_t s;
    float l[256];
    float r[256];
    float peak = 0.0f;

    dustline_init(&s);
    dustline_set_param(&s, dustline_param_id("cutoff"), cutoff);
    dustline_set_param(&s, dustline_param_id("resonance"), resonance);
    dustline_set_param(&s, dustline_param_id("drive"), drive);
    dustline_set_param(&s, dustline_param_id("noise"), noise);
    dustline_set_param(&s, dustline_param_id("volume"), 1.0f);
    dustline_note_on(&s, 60, 1.0f);

    for (int block = 0; block < 160; block++) {
        if (block == 120) dustline_note_off(&s, 60);
        dustline_process_float(&s, NULL, NULL, l, r, 256);
        for (int i = 0; i < 256; i++) {
            if (!isfinite(l[i]) || !isfinite(r[i])) return -1.0f;
            if (absf_local(l[i]) > 1.0f || absf_local(r[i]) > 1.0f) return -1.0f;
            if (absf_local(l[i]) > peak) peak = absf_local(l[i]);
        }
    }
    return peak;
}

static void test_param_space_is_stable(void) {
    /* Every point on the declared cutoff x resonance plane, at three drive
     * settings and with the noise source both off and full. */
    for (int ci = 0; ci <= 20; ci++) {
        for (int ri = 0; ri <= 19; ri++) {
            for (int di = 0; di <= 2; di++) {
                for (int ni = 0; ni <= 1; ni++) {
                    float cutoff = (float)ci / 20.0f;
                    float resonance = (float)ri * 0.05f;
                    float peak = sweep_point(cutoff, resonance, (float)di * 0.5f, (float)ni);
                    if (peak < 0.0f) {
                        fprintf(stderr,
                                "FAIL: unstable at cutoff=%.2f resonance=%.2f drive=%.1f noise=%.0f\n",
                                cutoff, resonance, (float)di * 0.5f, (float)ni);
                        exit(1);
                    }
                }
            }
        }
    }

    /* The two shipped presets that were silently divergent. */
    require_true(sweep_point(0.70f, 0.56f, 0.0f, 1.0f) > 0.01f, "Air Noise preset is stable and audible");
    require_true(sweep_point(0.62f, 0.64f, 0.0f, 0.0f) > 0.01f, "Glass Keys preset is stable and audible");
}

/* Sum |x[n] - x[n-1]| over a render, normalized by RMS: a cheap spectral-tilt
 * proxy. The probe note (A2, ~110 Hz) sits well below the probe cutoff
 * (~2.9 kHz), so a resonant filter rings above the fundamental and *adds*
 * high-frequency content — normalized slew rises with resonance, by ~12x
 * across the range. Inverting the wiring reverses that cleanly. */
static double normalized_slew(float cutoff, float resonance) {
    dustline_core_t s;
    float l[256];
    float r[256];
    double slew = 0.0;
    double energy = 0.0;
    float prev = 0.0f;

    dustline_init(&s);
    dustline_set_param(&s, dustline_param_id("cutoff"), cutoff);
    dustline_set_param(&s, dustline_param_id("resonance"), resonance);
    dustline_set_param(&s, dustline_param_id("drive"), 0.0f);
    dustline_set_param(&s, dustline_param_id("noise"), 0.0f);
    dustline_set_param(&s, dustline_param_id("volume"), 0.5f);
    dustline_note_on(&s, 45, 1.0f);

    for (int block = 0; block < 40; block++) {
        dustline_process_float(&s, NULL, NULL, l, r, 256);
        if (block < 20) continue; /* let the envelope settle */
        for (int i = 0; i < 256; i++) {
            slew += fabs((double)l[i] - (double)prev);
            energy += (double)l[i] * (double)l[i];
            prev = l[i];
        }
    }
    return energy > 0.0 ? slew / sqrt(energy) : 0.0;
}

static void test_resonance_is_wired_the_right_way_round(void) {
    /* The control must move in the direction its label implies. The previous
     * mapping raised the SVF damping term as `resonance` rose, so the knob ran
     * backwards: most resonant at 0, flat by 0.38, divergent past 0.5.
     *
     * Note this asserts dustline's *wiring*, not the filter's response — the
     * output saturator compresses peak amplitude, so peak level cannot
     * distinguish resonance settings here. Peak gain is asserted directly
     * against the shared block in tests/test_mf_dsp.c. */
    double low = normalized_slew(0.5f, 0.05f);
    double mid = normalized_slew(0.5f, 0.50f);
    double high = normalized_slew(0.5f, 0.90f);

    require_true(low > 0.0 && mid > 0.0 && high > 0.0, "resonance probes produce signal");
    require_true(mid > low * 1.5, "mid resonance rings more than low (knob is not inverted)");
    require_true(high > mid * 1.5, "high resonance rings more than mid (knob is not inverted)");
}

/* Normalized autocorrelation of a buffer at one lag. 1.0 means the signal
 * repeats exactly at that spacing. */
static double autocorrelation(const float *x, int n, int lag) {
    const int from = n / 8;           /* skip the attack */
    const int to = n - lag - 1;
    double num = 0.0;
    double da = 0.0;
    double db = 0.0;
    for (int i = from; i < to; i++) {
        num += (double)x[i] * (double)x[i + lag];
        da += (double)x[i] * (double)x[i];
        db += (double)x[i + lag] * (double)x[i + lag];
    }
    return num / (sqrt(da * db) + 1e-30);
}

static void test_noise_source_is_actually_noise(void) {
    /* The PRNG used to round-trip its 32-bit state through a float, losing the
     * low 8 bits every sample. Measured through the module that produced an
     * autocorrelation of exactly 1.0 at a lag of 651 samples — a periodic
     * 67.7 Hz buzz rather than noise. Nothing in the metric suite could see it:
     * peak, rms and DC are all perfectly reasonable for a periodic signal. */
    enum { N = 132300 };              /* 3 s */
    static float buf[N];
    dustline_core_t s;
    float l[128];
    float r[128];

    dustline_init(&s);
    dustline_set_param(&s, dustline_param_id("noise"), 1.0f);      /* noise only */
    dustline_set_param(&s, dustline_param_id("cutoff"), 1.0f);     /* filter wide open */
    dustline_set_param(&s, dustline_param_id("resonance"), 0.0f);
    dustline_set_param(&s, dustline_param_id("drive"), 0.0f);
    dustline_set_param(&s, dustline_param_id("volume"), 1.0f);
    dustline_set_param(&s, dustline_param_id("attack"), 0.001f);
    dustline_note_on(&s, 60, 1.0f);

    for (int i = 0; i < N; i += 128) {
        dustline_process_float(&s, NULL, NULL, l, r, 128);
        for (int j = 0; j < 128 && i + j < N; j++) buf[i + j] = l[j];
    }

    require_true(autocorrelation(buf, N, 651) < 0.2,
                 "noise does not repeat at the old 651-sample period");

    /* Scan for any strong periodicity, not just the one we knew about. */
    double worst = 0.0;
    int worst_lag = 0;
    for (int lag = 200; lag < 30000; lag += 7) {
        double a = fabs(autocorrelation(buf, N, lag));
        if (a > worst) {
            worst = a;
            worst_lag = lag;
        }
    }
    if (worst > 0.2) {
        fprintf(stderr, "FAIL: noise repeats with autocorrelation %.4f at lag %d\n", worst, worst_lag);
        exit(1);
    }
}


/* Releasing a note while a lower one is still held must fall back to it, not go
 * silent. All three sound generators tracked a single `active_note` and cleared
 * the gate whenever a note-off matched it, so press A / press B / release B left
 * the voice silent with A still down. Verified on dustline before the fix:
 * gate 0, active_note -1. */
static void test_held_note_falls_back(void) {
    dustline_core_t v;
    float l[128], r[128];

    dustline_init(&v);
    dustline_note_on(&v, 60, 1.0f);
    dustline_process_float(&v, NULL, NULL, l, r, 128);
    dustline_note_on(&v, 64, 1.0f);
    dustline_process_float(&v, NULL, NULL, l, r, 128);

    dustline_note_off(&v, 64);
    dustline_process_float(&v, NULL, NULL, l, r, 128);
    require_true(v.gate > 0.5f, "releasing the upper note leaves the voice sounding");
    require_true(v.active_note == 60, "the still-held lower note takes over");

    dustline_note_off(&v, 60);
    dustline_process_float(&v, NULL, NULL, l, r, 128);
    require_true(v.gate < 0.5f, "releasing the last held note stops the voice");
    require_true(v.active_note == -1, "no note is tracked once all are released");

    /* Releasing an underlying note must not disturb the sounding one. */
    dustline_init(&v);
    dustline_note_on(&v, 60, 1.0f);
    dustline_note_on(&v, 64, 1.0f);
    dustline_note_off(&v, 60);
    require_true(v.gate > 0.5f && v.active_note == 64,
                 "releasing an underlying note leaves the sounding note alone");
    dustline_note_off(&v, 64);
    require_true(v.gate < 0.5f, "and then releasing it stops, with no ghost entry");

    /* all-notes-off clears the whole stack, not just the top. */
    dustline_init(&v);
    dustline_note_on(&v, 60, 1.0f);
    dustline_note_on(&v, 64, 1.0f);
    dustline_all_notes_off(&v);
    require_true(v.gate < 0.5f && v.active_note == -1, "all-notes-off silences the voice");
    dustline_note_off(&v, 60);
    require_true(v.gate < 0.5f, "a stale note-off after all-notes-off does not revive it");
}

int main(void) {
    dustline_core_t synth;
    float left[FRAMES];
    float right[FRAMES];
    dustline_init(&synth);

    int volume_id = dustline_param_id("volume");
    int attack_id = dustline_param_id("attack");
    int cutoff_id = dustline_param_id("cutoff");

    dustline_set_param(&synth, volume_id, 2.0f);
    require_true(dustline_get_param(&synth, volume_id) <= 1.0f, "volume clamps high");

    dustline_set_param(&synth, attack_id, -1.0f);
    require_true(dustline_get_param(&synth, attack_id) >= 0.001f, "attack clamps low");

    dustline_set_param(&synth, volume_id, 0.8f);
    dustline_set_param(&synth, cutoff_id, 0.72f);
    dustline_note_on(&synth, 60, 1.0f);
    dustline_process_float(&synth, NULL, NULL, left, right, FRAMES);

    float peak = 0.0f;
    double energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(left[i]) && isfinite(right[i]), "render output is finite");
        require_true(left[i] <= 1.0f && left[i] >= -1.0f, "left output remains normalized");
        require_true(right[i] <= 1.0f && right[i] >= -1.0f, "right output remains normalized");
        float a = absf_local(left[i]);
        if (a > peak) peak = a;
        energy += (double)left[i] * (double)left[i];
    }
    require_true(peak > 0.001f, "note-on render is not silent");
    require_true(energy > 0.01, "note-on render has energy");

    dustline_set_param(&synth, volume_id, 0.0f);
    dustline_process_float(&synth, NULL, NULL, left, right, FRAMES);
    float muted_peak = 0.0f;
    double muted_energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(left[i]) && isfinite(right[i]), "muted output is finite");
        float l = absf_local(left[i]);
        float r = absf_local(right[i]);
        if (l > muted_peak) muted_peak = l;
        if (r > muted_peak) muted_peak = r;
        muted_energy += (double)left[i] * (double)left[i] + (double)right[i] * (double)right[i];
    }
    require_true(muted_peak < 0.0001f, "volume zero mutes held note output");
    require_true(muted_energy < 0.000001, "volume zero removes held note energy");

    dustline_set_param(&synth, volume_id, 0.8f);
    dustline_process_float(&synth, NULL, NULL, left, right, FRAMES);

    dustline_note_off(&synth, 60);
    float before = synth.env;
    dustline_process_float(&synth, NULL, NULL, left, right, FRAMES);
    require_true(synth.env < before, "release envelope decays after note off");

    require_true(dustline_param_id("cutoff") >= 0, "param lookup works");
    require_true(dustline_param_id("does_not_exist") < 0, "unknown param lookup fails");

    test_noise_source_is_actually_noise();
    test_param_space_is_stable();
    test_resonance_is_wired_the_right_way_round();

    test_held_note_falls_back();


    printf("dustline core tests passed\n");
    return 0;
}

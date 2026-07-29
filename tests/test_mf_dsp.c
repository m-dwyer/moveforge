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

static void test_sanitize(void) {
    require_true(mf_is_bad(NAN), "NaN is bad");
    require_true(mf_is_bad(INFINITY), "inf is bad");
    require_true(mf_is_bad(-INFINITY), "-inf is bad");
    require_true(mf_is_bad(1.0e9f), "absurd magnitude is bad");
    require_true(!mf_is_bad(0.0f), "zero is fine");
    require_true(!mf_is_bad(-0.9f), "normal value is fine");
    require_true(mf_sanitize(NAN, 0.0f) == 0.0f, "NaN sanitizes to the fallback");
    require_true(mf_sanitize(0.5f, 0.0f) == 0.5f, "good value passes through");
}

static void test_wrap_phase(void) {
    require_true(absf_local(mf_wrap_phase(0.25f) - 0.25f) < 1e-6f, "in-range phase unchanged");
    require_true(absf_local(mf_wrap_phase(1.25f) - 0.25f) < 1e-6f, "phase above 1 wraps down");
    require_true(absf_local(mf_wrap_phase(-0.25f) - 0.75f) < 1e-6f, "negative phase wraps up");
    require_true(mf_wrap_phase(5.0f) >= 0.0f && mf_wrap_phase(5.0f) < 1.0f, "large phase lands in range");
    require_true(mf_wrap_phase(-5.5f) >= 0.0f && mf_wrap_phase(-5.5f) < 1.0f, "large negative lands in range");
}

static void test_onepole(void) {
    mf_onepole_t f;
    mf_onepole_init(&f);
    mf_onepole_set_hz(&f, 1000.0f);

    /* A step settles toward the input and never overshoots it. */
    float prev = 0.0f;
    for (int i = 0; i < 2000; i++) {
        float y = mf_onepole_tick(&f, 1.0f);
        require_true(y >= prev - 1e-6f, "one-pole step response is monotonic");
        require_true(y <= 1.0f + 1e-6f, "one-pole does not overshoot");
        prev = y;
    }
    require_true(prev > 0.99f, "one-pole settles to its input");

    /* Higher corner means faster settling. */
    mf_onepole_t slow, fast;
    mf_onepole_init(&slow);
    mf_onepole_init(&fast);
    mf_onepole_set_hz(&slow, 100.0f);
    mf_onepole_set_hz(&fast, 4000.0f);
    for (int i = 0; i < 100; i++) {
        mf_onepole_tick(&slow, 1.0f);
        mf_onepole_tick(&fast, 1.0f);
    }
    require_true(fast.y > slow.y, "higher corner settles faster");
}

static void test_smooth(void) {
    /* Reaches ~63% of a step in the nominal time, and all of it eventually. */
    mf_smooth_t s;
    mf_smooth_init(&s, 5.0f);
    int n = (int)(0.005f * MOVEFORGE_SAMPLE_RATE);
    for (int i = 0; i < n; i++) mf_smooth_tick(&s, 1.0f);
    require_true(s.value > 0.55f && s.value < 0.70f, "smoother hits ~63% at its time constant");
    for (int i = 0; i < n * 10; i++) mf_smooth_tick(&s, 1.0f);
    require_true(s.value > 0.999f, "smoother converges");

    /* It must actually smooth: a step never arrives in one sample. */
    mf_smooth_t step;
    mf_smooth_init(&step, 5.0f);
    require_true(mf_smooth_tick(&step, 1.0f) < 0.1f, "a step does not arrive instantly");

    /* snap bypasses smoothing, for note-on. */
    mf_smooth_snap(&step, 0.42f);
    require_true(step.value == 0.42f, "snap sets the value directly");

    /* Gain variant collapses to exact zero, and faster than it rises. */
    mf_smooth_t gain;
    mf_smooth_init_gain(&gain, 5.0f, 0.5f);
    mf_smooth_snap(&gain, 1.0f);
    int mute_samples = 0;
    while (gain.value != 0.0f && mute_samples < 100000) {
        mf_smooth_tick(&gain, 0.0f);
        mute_samples++;
    }
    require_true(gain.value == 0.0f, "gain smoother reaches exact zero");
    require_true(mute_samples < (int)(0.02f * MOVEFORGE_SAMPLE_RATE),
                 "gain smoother mutes within ~20ms");
}

static void test_ar_envelope(void) {
    mf_ar_t e;
    mf_ar_init(&e);
    mf_ar_set_times(&e, 0.01f, 0.05f);

    for (int i = 0; i < (int)(0.1f * MOVEFORGE_SAMPLE_RATE); i++) mf_ar_tick(&e, 1, 1.0f);
    require_true(e.value > 0.99f, "envelope reaches sustain while gated");

    for (int i = 0; i < (int)(0.5f * MOVEFORGE_SAMPLE_RATE); i++) mf_ar_tick(&e, 0, 1.0f);
    require_true(e.value < 0.001f, "envelope releases to silence");

    /* A sustain below 1 is held, not overshot — the decay-to-hold shape. */
    mf_ar_t hold;
    mf_ar_init(&hold);
    mf_ar_set_times(&hold, 0.005f, 0.05f);
    for (int i = 0; i < (int)(0.2f * MOVEFORGE_SAMPLE_RATE); i++) mf_ar_tick(&hold, 1, 0.4f);
    require_true(absf_local(hold.value - 0.4f) < 0.01f, "envelope holds at the sustain level");

    /* Zero and negative times must not produce NaN or run away. */
    mf_ar_t degenerate;
    mf_ar_init(&degenerate);
    mf_ar_set_times(&degenerate, 0.0f, -1.0f);
    for (int i = 0; i < 100; i++) {
        float v = mf_ar_tick(&degenerate, i < 50, 1.0f);
        require_true(isfinite(v) && v >= 0.0f && v <= 1.0f, "degenerate envelope times stay bounded");
    }
}

static void test_tanh_approx(void) {
    /* Bounded to full scale for every input, including absurd ones. */
    const float probes[] = { -1.0e9f, -100.0f, -3.0f, -1.0f, 0.0f, 1.0f, 3.0f, 100.0f, 1.0e9f };
    for (int i = 0; i < (int)(sizeof(probes) / sizeof(probes[0])); i++) {
        float y = mf_tanh_approx(probes[i]);
        require_true(isfinite(y), "tanh approx is finite");
        require_true(y >= -1.0f && y <= 1.0f, "tanh approx stays within full scale");
    }
    require_true(mf_tanh_approx(0.0f) == 0.0f, "tanh approx is zero at zero");
    require_true(mf_tanh_approx(-0.5f) == -mf_tanh_approx(0.5f), "tanh approx is odd");

    /* Close enough to the real thing to substitute for it in a saturator. */
    float worst = 0.0f;
    float worst_at = 0.0f;
    for (float x = -6.0f; x <= 6.0f; x += 0.002f) {
        float err = absf_local(mf_tanh_approx(x) - tanhf(x));
        if (err > worst) {
            worst = err;
            worst_at = x;
        }
    }
    /* Measured 0.00087 for the Pade 5/4 in use; 0.002 leaves headroom without
     * silently admitting a much coarser approximation. */
    if (worst > 0.002f) {
        fprintf(stderr, "FAIL: tanh approx error %.5f at x=%.3f exceeds 0.002\n", worst, worst_at);
        exit(1);
    }
    /* Monotonic, so it cannot introduce fold-back distortion of its own. */
    float prev = mf_tanh_approx(-6.0f);
    for (float x = -6.0f; x <= 6.0f; x += 0.005f) {
        float y = mf_tanh_approx(x);
        require_true(y >= prev - 1e-6f, "tanh approx is monotonic");
        prev = y;
    }
}

static void test_soft_limit(void) {
    /* Exactly identity below the knee — this is what lets a limiter sit in a
     * passthrough path without breaking it. */
    require_true(mf_soft_limit(0.0f) == 0.0f, "soft limit is identity at zero");
    require_true(mf_soft_limit(0.5f) == 0.5f, "soft limit is identity below the knee");
    require_true(mf_soft_limit(-0.5f) == -0.5f, "soft limit is identity below the knee (negative)");
    require_true(mf_soft_limit(MF_SOFT_LIMIT_KNEE) == MF_SOFT_LIMIT_KNEE, "identity at the knee");

    /* Bounded, monotonic, odd, and continuous through the knee. */
    float prev = mf_soft_limit(-8.0f);
    for (float x = -8.0f; x <= 8.0f; x += 0.001f) {
        float y = mf_soft_limit(x);
        require_true(isfinite(y), "soft limit is finite");
        require_true(y >= -1.0f && y <= 1.0f, "soft limit never exceeds full scale");
        require_true(y >= prev - 1e-6f, "soft limit is monotonic");
        require_true(absf_local(y - prev) < 0.01f, "soft limit has no jump discontinuity");
        prev = y;
    }
    require_true(absf_local(mf_soft_limit(2.0f) + mf_soft_limit(-2.0f)) < 1e-6f, "soft limit is odd");
    require_true(mf_soft_limit(1000.0f) > 0.99f, "soft limit approaches full scale");

    /* And it actually compresses rather than passing overshoot through. */
    require_true(mf_soft_limit(1.5f) < 1.0f, "overshoot is limited");
    require_true(mf_soft_limit(1.5f) > MF_SOFT_LIMIT_KNEE, "limited value stays above the knee");
}

static void test_rng(void) {
    mf_rng_t r;
    mf_rng_init(&r, 0x12345678u);

    /* Range, and a mean near zero over a long run. */
    double sum = 0.0;
    int n = 200000;
    for (int i = 0; i < n; i++) {
        float v = mf_rng_bipolar(&r);
        require_true(v >= -1.0f && v < 1.0f, "rng output is in [-1, 1)");
        sum += v;
    }
    require_true(absf_local((float)(sum / n)) < 0.01f, "rng mean is near zero");

    /* No short period: dustline's float round-trip repeated every 7412 samples.
     * Walk far past that and confirm the state never returns to its seed. */
    mf_rng_t p;
    mf_rng_init(&p, 0x12345678u);
    uint32_t seed_state = p.state;
    for (int i = 0; i < 2000000; i++) {
        if (mf_rng_next_u32(&p) == seed_state) {
            fprintf(stderr, "FAIL: rng period is only %d samples\n", i + 1);
            exit(1);
        }
    }

    /* Deterministic from a seed — renders have to be reproducible. */
    mf_rng_t a, b;
    mf_rng_init(&a, 99u);
    mf_rng_init(&b, 99u);
    for (int i = 0; i < 1000; i++) {
        require_true(mf_rng_next_u32(&a) == mf_rng_next_u32(&b), "rng is deterministic per seed");
    }
    /* A zero seed must not lock the generator at zero. */
    mf_rng_t z;
    mf_rng_init(&z, 0u);
    require_true(mf_rng_next_u32(&z) != 0u, "zero seed still generates");
}

static void test_voice_held_note_stack(void) {
    mf_voice_t v;
    int n = -1;
    float vel = 0.0f;

    mf_voice_init(&v);
    require_true(mf_voice_current(&v) == -1, "nothing sounds before any note");
    require_true(mf_voice_note_off(&v, 60, &n, &vel) == MF_VOICE_UNCHANGED,
                 "a note-off with nothing held is ignored");

    /* The bug this exists for: press A, press B, release B -> A must resume. */
    require_true(mf_voice_note_on(&v, 60, 1.0f, &n, &vel) == MF_VOICE_START, "A starts");
    require_true(n == 60, "A is the sounding note");
    require_true(mf_voice_note_on(&v, 64, 0.5f, &n, &vel) == MF_VOICE_START, "B takes over");
    require_true(n == 64, "B is the sounding note");
    require_true(mf_voice_note_off(&v, 64, &n, &vel) == MF_VOICE_START,
                 "releasing B falls back rather than stopping");
    require_true(n == 60, "the fallback is the still-held A");
    require_true(absf_local(vel - 1.0f) < 1e-6f, "the fallback restores A's velocity");
    require_true(mf_voice_note_off(&v, 60, &n, &vel) == MF_VOICE_STOP,
                 "releasing the last held note stops the voice");
    require_true(mf_voice_current(&v) == -1, "nothing sounds once all are released");

    /* Releasing a note that is not the sounding one changes nothing. */
    mf_voice_init(&v);
    mf_voice_note_on(&v, 60, 1.0f, &n, &vel);
    mf_voice_note_on(&v, 64, 1.0f, &n, &vel);
    require_true(mf_voice_note_off(&v, 60, &n, &vel) == MF_VOICE_UNCHANGED,
                 "releasing an underlying note does not disturb the sounding one");
    require_true(mf_voice_current(&v) == 64, "B keeps sounding");
    require_true(mf_voice_note_off(&v, 64, &n, &vel) == MF_VOICE_STOP,
                 "and releasing B then stops, with no ghost entry for A");

    /* Retriggering a held note must not leave a duplicate behind. */
    mf_voice_init(&v);
    mf_voice_note_on(&v, 60, 1.0f, &n, &vel);
    mf_voice_note_on(&v, 64, 1.0f, &n, &vel);
    mf_voice_note_on(&v, 60, 0.8f, &n, &vel);
    require_true(mf_voice_current(&v) == 60, "retriggered A is on top");
    require_true(mf_voice_note_off(&v, 60, &n, &vel) == MF_VOICE_START && n == 64,
                 "releasing it falls back to B");
    require_true(mf_voice_note_off(&v, 64, &n, &vel) == MF_VOICE_STOP,
                 "no duplicate A remains on the stack");

    /* all-off clears everything. */
    mf_voice_init(&v);
    for (int i = 0; i < 5; i++) mf_voice_note_on(&v, 60 + i, 1.0f, &n, &vel);
    require_true(mf_voice_all_off(&v) == MF_VOICE_STOP, "all-off stops the voice");
    require_true(mf_voice_current(&v) == -1, "all-off empties the stack");

    /* Overflow drops the oldest rather than refusing the newest, and the stack
     * stays consistent afterwards. */
    mf_voice_init(&v);
    for (int i = 0; i < MF_VOICE_MAX_HELD + 4; i++) {
        mf_voice_note_on(&v, 40 + i, 1.0f, &n, &vel);
        require_true(v.count <= MF_VOICE_MAX_HELD, "stack never exceeds its bound");
    }
    require_true(mf_voice_current(&v) == 40 + MF_VOICE_MAX_HELD + 3,
                 "the newest note still sounds after overflow");
    int releases = 0;
    while (mf_voice_current(&v) >= 0 && releases < 100) {
        mf_voice_note_off(&v, mf_voice_current(&v), &n, &vel);
        releases++;
    }
    require_true(v.count == 0, "the stack drains cleanly after overflow");

    /* Out-of-range notes are rejected without corrupting state. */
    mf_voice_init(&v);
    require_true(mf_voice_note_on(&v, -1, 1.0f, &n, &vel) == MF_VOICE_UNCHANGED, "note -1 rejected");
    require_true(mf_voice_note_on(&v, 128, 1.0f, &n, &vel) == MF_VOICE_UNCHANGED, "note 128 rejected");
    require_true(v.count == 0, "rejected notes do not enter the stack");
}

static void test_beats_to_samples(void) {
    /* One beat at 60 BPM is one second. */
    require_true(mf_beats_to_samples(1.0f, 60.0f) == (int)MOVEFORGE_SAMPLE_RATE,
                 "1 beat at 60bpm is 1 second");
    require_true(mf_beats_to_samples(2.0f, 120.0f) == (int)MOVEFORGE_SAMPLE_RATE,
                 "2 beats at 120bpm is 1 second");
    require_true(mf_beats_to_samples(0.25f, 120.0f) == (int)(MOVEFORGE_SAMPLE_RATE / 8),
                 "a sixteenth at 120bpm is an eighth of a second");
    /* Degenerate inputs are clamped rather than producing huge or negative
     * lengths that would index out of a delay buffer. */
    require_true(mf_beats_to_samples(1.0f, 0.0f) > 0, "zero bpm is clamped");
    require_true(mf_beats_to_samples(-5.0f, 120.0f) == 0, "negative beats clamp to zero");
    require_true(mf_beats_to_samples(1.0e9f, 0.001f) <= 2000000000, "absurd length is capped");
}

static void test_tilt(void) {
    mf_tilt_t t;
    float gl, gh;

    /* The reason for the complementary-crossover form: at 0 dB the filter must
     * be transparent exactly, not approximately. A shelving-biquad tilt ripples
     * at its centre detent, so a control reading "flat" changes the tone. */
    mf_tilt_gains(0.0f, 24.0f, &gl, &gh);
    require_true(absf_local(gl - 1.0f) < 1e-6f, "tilt centre leaves lows at unity");
    require_true(absf_local(gh - 1.0f) < 1e-6f, "tilt centre leaves highs at unity");

    mf_tilt_init(&t, 700.0f);
    for (int i = 0; i < 512; i++) {
        float x = sinf(0.05f * (float)i) * 0.7f + sinf(0.9f * (float)i) * 0.3f;
        require_true(absf_local(mf_tilt_tick(&t, x, gl, gh) - x) < 1e-6f,
                     "tilt at centre passes the signal unchanged");
    }

    /* Symmetric in dB about the pivot, and the two ends are reciprocal. */
    mf_tilt_gains(1.0f, 24.0f, &gl, &gh);
    require_true(gh > 3.9f && gh < 4.1f, "full tilt lifts highs by 12 dB");
    require_true(absf_local(gl * gh - 1.0f) < 1e-4f, "tilt gains are reciprocal");

    float gl_down, gh_down;
    mf_tilt_gains(-1.0f, 24.0f, &gl_down, &gh_down);
    require_true(absf_local(gl_down - gh) < 1e-4f, "tilt is symmetric end to end");

    /* Tilting up must actually make a bright signal louder than a dark one. */
    mf_tilt_init(&t, 700.0f);
    double dark = 0.0;
    for (int i = 0; i < 2048; i++) {
        float y = mf_tilt_tick(&t, sinf(0.014f * (float)i), gl, gh);   /* ~100 Hz */
        dark += (double)y * y;
    }
    mf_tilt_init(&t, 700.0f);
    double bright = 0.0;
    for (int i = 0; i < 2048; i++) {
        float y = mf_tilt_tick(&t, sinf(0.71f * (float)i), gl, gh);    /* ~5 kHz */
        bright += (double)y * y;
    }
    require_true(bright > dark * 4.0, "tilting up favours highs over lows");
}

static void test_fold(void) {
    /* Identity inside [-1, 1] — a folder that colours its passband is a
     * distortion with an unusable bottom half. */
    for (int i = -100; i <= 100; i++) {
        float x = (float)i / 100.0f;
        require_true(absf_local(mf_fold(x) - x) < 1e-6f, "fold is identity in range");
    }

    /* Reflects rather than wraps: 1.5 folds back to 0.5, not to -0.5. */
    require_true(absf_local(mf_fold(1.5f) - 0.5f) < 1e-5f, "1.5 folds to 0.5");
    require_true(absf_local(mf_fold(2.0f) - 0.0f) < 1e-5f, "2.0 folds to 0");
    require_true(absf_local(mf_fold(3.0f) + 1.0f) < 1e-5f, "3.0 folds to -1");
    require_true(absf_local(mf_fold(-1.5f) + 0.5f) < 1e-5f, "-1.5 folds to -0.5");

    /* Continuous everywhere. A modulo-based folder steps by full scale at the
     * fold points, which sounds like a fault rather than a wavefolder. */
    float prev = mf_fold(-8.0f);
    for (int i = -7999; i <= 8000; i++) {
        float y = mf_fold((float)i / 1000.0f);
        require_true(absf_local(y - prev) < 0.01f, "fold has no discontinuity");
        require_true(y >= -1.0f && y <= 1.0f, "fold stays in range");
        prev = y;
    }
}

static void test_drive(void) {
    mf_drive_t state;
    mf_drive_coeffs_t c;

    for (int curve = 0; curve < MF_DRIVE_COUNT; curve++) {
        /* Drive zero is clean for every curve. Without this the knob is a dead
         * zone in some modes and a distortion in others, and the curve
         * selector stops being an A/B. */
        mf_drive_init(&state);
        mf_drive_set(&c, curve, 0.0f);
        double err = 0.0;
        for (int i = 0; i < 2048; i++) {
            float x = sinf(0.03f * (float)i) * 0.9f;
            float d = mf_drive_tick(&state, &c, x) - x;
            err += (double)d * d;
        }
        require_true(err / 2048.0 < 1.0e-4, "drive at zero is clean");

        /* Peak-normalised, so raising drive changes character and not level. */
        for (int step = 0; step <= 10; step++) {
            mf_drive_init(&state);
            mf_drive_set(&c, curve, (float)step / 10.0f);
            float peak = 0.0f;
            for (int i = 0; i < 4096; i++) {
                float y = mf_drive_tick(&state, &c, sinf(0.03f * (float)i));
                require_true(isfinite(y), "drive output is finite");
                require_true(y >= -1.05f && y <= 1.05f, "drive stays inside full scale");
                float a = absf_local(y);
                if (a > peak) peak = a;
            }
            /* Every curve measures exactly 1.000 here, so `> 0.6` asserted
             * peak-normalisation only to +-4.4 dB and caught nothing. */
            require_true(peak > 0.9f && peak < 1.05f,
                         "drive keeps its level as it is pushed");
        }
    }

    /* Every curve must actually be a curve. Without this, `return x` — the
     * nonlinearity doing nothing at all — passes for soft, clip and fold,
     * which is three of the five. Measured deviation from the input at full
     * drive is 0.27 (crush, the weakest) to 1.08 (fold), so 0.15 has better
     * than 1.8x margin on the closest case. */
    for (int curve = 0; curve < MF_DRIVE_COUNT; curve++) {
        mf_drive_init(&state);
        mf_drive_set(&c, curve, 1.0f);
        double dev = 0.0;
        for (int i = 0; i < 4096; i++) {
            float x = sinf(0.03f * (float)i);
            float d = mf_drive_tick(&state, &c, x) - x;
            dev += (double)d * d;
        }
        require_true(sqrt(dev / 4096.0) > 0.15, "a driven curve changes its input");
    }

    /* Shape fingerprints, so one curve cannot be silently substituted for
     * another. Fold is the only non-monotone curve — that is what makes it a
     * folder rather than a clipper, and asserting it is what catches
     * FOLD being replaced by hard clip. */
    for (int curve = 0; curve < MF_DRIVE_COUNT; curve++) {
        mf_drive_init(&state);
        mf_drive_set(&c, curve, 1.0f);
        /* Crush's sample-and-hold starts at zero, so without a warm-up its
         * first update falls to the ramp's starting value and reads as
         * non-monotone. That is an initialisation artefact, not a shape. */
        for (int i = 0; i < 64; i++) mf_drive_tick(&state, &c, -1.0f);
        int falls = 0;
        float prev = mf_drive_tick(&state, &c, -1.0f);
        for (int i = 1; i <= 2000; i++) {
            float y = mf_drive_tick(&state, &c, -1.0f + 2.0f * (float)i / 2000.0f);
            if (y < prev - 1.0e-6f) falls++;
            prev = y;
        }
        if (curve == MF_DRIVE_FOLD) {
            require_true(falls > 100, "fold folds back on itself");
        } else {
            require_true(falls == 0, "every curve but fold is monotone");
        }
    }

    /* An out-of-range curve index falls back rather than reading past the
     * switch — set_param clamps, but the enum and the clamp are separate. */
    mf_drive_set(&c, 99, 0.5f);
    require_true(c.curve == MF_DRIVE_SOFT, "an unknown curve falls back to soft");

    /* Asym is what it says: a symmetric input comes out with a DC offset,
     * which is where its even harmonics come from. Soft must not. */
    mf_drive_init(&state);
    mf_drive_set(&c, MF_DRIVE_ASYM, 1.0f);
    double asym_sum = 0.0;
    for (int i = 0; i < 4410; i++) asym_sum += mf_drive_tick(&state, &c, sinf(0.06f * (float)i));
    mf_drive_init(&state);
    mf_drive_set(&c, MF_DRIVE_SOFT, 1.0f);
    double soft_sum = 0.0;
    for (int i = 0; i < 4410; i++) soft_sum += mf_drive_tick(&state, &c, sinf(0.06f * (float)i));
    require_true(fabs(asym_sum) > fabs(soft_sum) * 10.0 + 1.0,
                 "asym produces the DC offset that soft does not");

    /* Crush holds its output between updates; that sample-and-hold is the
     * decimation, and without it the curve is only a bit reducer. */
    mf_drive_init(&state);
    mf_drive_set(&c, MF_DRIVE_CRUSH, 1.0f);
    int repeats = 0;
    float prev = mf_drive_tick(&state, &c, 0.0f);
    for (int i = 1; i < 2048; i++) {
        float y = mf_drive_tick(&state, &c, sinf(0.03f * (float)i));
        if (y == prev) repeats++;
        prev = y;
    }
    require_true(repeats > 1800, "crush decimates by holding samples");
}

/* ---------------------------------------------------------------------------
 * mf_decay_t — two-stage decay envelope
 * ------------------------------------------------------------------------- */

/* Time for the crossfaded envelope to fall `drop` below its peak of 1. */
static float decay_length(float decay_s, float shape, float drop) {
    mf_decay_coeffs_t c;
    mf_decay_t e;
    mf_decay_set(&c, decay_s, shape);
    mf_decay_init(&e);
    mf_decay_trigger(&e);
    for (int i = 0; i < (int)(MOVEFORGE_SAMPLE_RATE * 10.0f); i++) {
        if (mf_decay_tick(&e, &c) < drop) return (float)i / MOVEFORGE_SAMPLE_RATE;
    }
    return 10.0f;
}

static void test_decay_ends_and_stays_ended(void) {
    mf_decay_coeffs_t c;
    mf_decay_t e;
    mf_decay_set(&c, 0.1f, 0.0f);
    mf_decay_init(&e);

    /* Untriggered it is silent, and idle — otherwise a voice would never
     * early-out before its first note. */
    require_true(mf_decay_tick(&e, &c) == 0.0f, "an untriggered decay is silent");
    require_true(mf_decay_is_idle(&e, 1.0e-4f), "an untriggered decay is idle");

    mf_decay_trigger(&e);
    require_true(!mf_decay_is_idle(&e, 1.0e-4f), "a triggered decay is not idle");

    /* The linear stage reaches exact zero rather than approaching it, so the
     * envelope has a real end. The exponential stage does not and cannot — which
     * is why is_idle takes an eps, and why a voice that tests only the exponential
     * stage keeps rendering forever. */
    for (int i = 0; i < (int)(0.3f * MOVEFORGE_SAMPLE_RATE); i++) mf_decay_tick(&e, &c);
    require_true(mf_decay_is_idle(&e, 1.0e-4f), "a spent decay reports idle");
    require_true(mf_decay_tick(&e, &c) < 1.0e-4f, "a spent decay stays below the idle floor");
    require_true(e.lin_v == 0.0f, "the linear stage reaches exact zero");

    mf_decay_trigger(&e);
    mf_decay_release(&e);
    require_true(mf_decay_tick(&e, &c) == 0.0f, "release collapses the envelope");

    /* Both stages have to be tested, not just the exponential one. At any eps
     * looser than -60 dB the exponential stage crosses it while the linear stage is
     * still well up: below, exp is at 0.0016 and lin at 0.2, so an idle test that
     * looked only at exp would let a voice early-out and cut a fifth of its own
     * envelope off. Ballast uses 1e-5, which is inside the safe range, so this only
     * shows up on a module that picks a looser floor. */
    mf_decay_coeffs_t lin_c;
    mf_decay_t lin_e;
    mf_decay_set(&lin_c, 0.5f, 1.0f);
    mf_decay_init(&lin_e);
    mf_decay_trigger(&lin_e);
    float level = 0.0f;
    for (int i = 0; i < (int)(0.4f * MOVEFORGE_SAMPLE_RATE); i++) {
        level = mf_decay_tick(&lin_e, &lin_c);
    }
    require_true(level > 0.15f, "a pure linear envelope is still up at 80% of its decay");
    require_true(lin_e.exp_v < 0.01f, "while the exponential stage has already gone quiet");
    require_true(!mf_decay_is_idle(&lin_e, 0.01f),
                 "idle is false while the linear stage is still audible");
}

static void test_decay_shape_is_monotone_and_bounded(void) {
    /* The control must never reverse: every step toward 1 makes the hit longer.
     * A non-monotone taper is the thing MF_DECAY_SHAPE_TAPER could most easily
     * break, and it would read as a broken knob rather than a wrong curve. */
    for (float dec = 0.05f; dec <= 2.01f; dec *= 4.0f) {
        float prev = 0.0f;
        for (int i = 0; i <= 20; i++) {
            float len = decay_length(dec, (float)i / 20.0f, 0.1f);
            require_true(len >= prev - 1.0e-6f, "shape never shortens the envelope");
            prev = len;
        }
    }

    /* Peak is 1 at both ends and everywhere between, so `shape` cannot be a
     * hidden gain control. */
    for (int i = 0; i <= 10; i++) {
        mf_decay_coeffs_t c;
        mf_decay_t e;
        mf_decay_set(&c, 0.2f, (float)i / 10.0f);
        mf_decay_init(&e);
        mf_decay_trigger(&e);
        float peak = 0.0f;
        for (int k = 0; k < (int)(0.3f * MOVEFORGE_SAMPLE_RATE); k++) {
            float v = mf_decay_tick(&e, &c);
            if (v > peak) peak = v;
        }
        require_true(peak > 0.99f && peak <= 1.0f, "peak is unity at every shape");
    }
}

static void test_decay_ends_are_exact(void) {
    /* shape 0 must be a pure exponential and shape 1 a pure linear ramp, which is
     * the property that makes the crossfade honest rather than approximate.
     * Checked by their -20 dB crossing times: exp reaches -20 dB a third of the
     * way through (20/60 of the -60 dB time), linear at 90%. */
    float exp_len = decay_length(0.6f, 0.0f, 0.1f);
    float lin_len = decay_length(0.6f, 1.0f, 0.1f);
    require_true(absf_local(exp_len - 0.6f / 3.0f) < 0.006f,
                 "shape 0 is the exponential's own -20 dB time");
    require_true(absf_local(lin_len - 0.6f * 0.9f) < 0.006f,
                 "shape 1 is the linear ramp's own -20 dB time");
}

static void test_decay_taper_evens_out_the_control(void) {
    /* Why MF_DECAY_SHAPE_TAPER is 1.25 and not 1. Ballast's linear crossfade put
     * 18.4% of the perceived-length range in the knob's first tenth, where an even
     * control would put 10%. Assert the taper actually corrects that, and that it
     * does not overshoot into a dead zone the way a square would.
     *
     * Mutation-tested: setting MF_DECAY_SHAPE_TAPER to 1.0 or 2.0 fails this. */
    const float dec = 0.5f;
    float first = decay_length(dec, 0.1f, 0.1f) - decay_length(dec, 0.0f, 0.1f);
    float total = decay_length(dec, 1.0f, 0.1f) - decay_length(dec, 0.0f, 0.1f);
    float share = first / total;
    require_true(share > 0.05f && share < 0.135f,
                 "the knob's first tenth is worth roughly a tenth of its range");

    /* And the first tenth still does something: 1.5 would move only 14 ms of the
     * 283 ms range here, which reads as a dead spot. */
    require_true(first > 0.018f, "the first tenth of the knob is not a dead zone");
}

/* ---------------------------------------------------------------------------
 * mf_reson_t — two-pole resonator
 * ------------------------------------------------------------------------- */

#define RESON_N 441000   /* 10 s, long enough for the longest T60 tested */
static float reson_buf[RESON_N];

static void reson_impulse(float hz, float t60, int n) {
    mf_reson_coeffs_t c;
    mf_reson_t s;
    mf_reson_set(&c, hz, t60);
    mf_reson_init(&s);
    for (int i = 0; i < n; i++) {
        reson_buf[i] = mf_reson_tick(&s, &c, i == 0 ? 1.0f : 0.0f);
    }
}

/* Time for the impulse response's envelope to fall 60 dB below its peak. Tracked
 * as a running max over one period so a zero crossing is not read as the end. */
static float reson_t60(int n, float hz) {
    int period = (int)(MOVEFORGE_SAMPLE_RATE / hz) + 1;
    float peak = 0.0f;
    for (int i = 0; i < n; i++) if (absf_local(reson_buf[i]) > peak) peak = absf_local(reson_buf[i]);
    if (peak <= 0.0f) return -1.0f;
    for (int i = 0; i + period < n; i++) {
        float local = 0.0f;
        for (int j = i; j < i + period; j++) {
            if (absf_local(reson_buf[j]) > local) local = absf_local(reson_buf[j]);
        }
        if (local < peak * 0.001f) return (float)i / MOVEFORGE_SAMPLE_RATE;
    }
    return -1.0f;
}

static void test_reson_delivers_the_t60_it_is_asked_for(void) {
    /* The whole reason this primitive exists. Measured error is within 1.3% for
     * T60 >= 50 ms; the tolerance below is 8%, which is loose enough for the
     * envelope tracker's one-period window and tight enough that dropping the
     * 6.9078 constant (or using the SVF instead) fails it. */
    const float freqs[] = { 100.0f, 200.0f, 1000.0f, 4000.0f, 8000.0f };
    const float t60s[] = { 0.05f, 0.5f, 2.0f, 4.0f };
    for (unsigned f = 0; f < sizeof(freqs) / sizeof(freqs[0]); f++) {
        for (unsigned t = 0; t < sizeof(t60s) / sizeof(t60s[0]); t++) {
            int n = (int)((t60s[t] * 1.5f + 0.1f) * MOVEFORGE_SAMPLE_RATE);
            if (n > RESON_N) n = RESON_N;
            reson_impulse(freqs[f], t60s[t], n);
            float got = reson_t60(n, freqs[f]);
            if (got <= 0.0f) {
                fprintf(stderr, "FAIL: resonator never decayed 60 dB at %.0f Hz, T60 %.3f s\n",
                        freqs[f], t60s[t]);
                exit(1);
            }
            if (absf_local(got - t60s[t]) > t60s[t] * 0.08f) {
                fprintf(stderr, "FAIL: %.0f Hz asked T60 %.1f ms, measured %.1f ms\n",
                        freqs[f], t60s[t] * 1000.0f, got * 1000.0f);
                exit(1);
            }
        }
    }
}

static void test_reson_beats_the_svf_at_holding_a_tail(void) {
    /* The claim in mf_reson_t's comment block, asserted rather than described: the
     * SVF's normalized resonance cannot hold a metallic tail at all, because
     * MF_SVF_Q_MAX caps its decay. If someone raises MF_SVF_Q_MAX enough to make
     * this fail, the resonator's reason for existing has changed and the comment
     * needs rewriting. */
    mf_svf_coeffs_t sc;
    mf_svf_t ss;
    mf_svf_set(&sc, 8000.0f, 1.0f);
    mf_svf_init(&ss);
    int n = (int)(0.5f * MOVEFORGE_SAMPLE_RATE);
    for (int i = 0; i < n; i++) {
        mf_svf_tick(&ss, &sc, i == 0 ? 1.0f : 0.0f);
        reson_buf[i] = ss.bp;
    }
    float svf_t60 = reson_t60(n, 8000.0f);
    require_true(svf_t60 > 0.0f && svf_t60 < 0.030f,
                 "the SVF at full resonance decays in under 30 ms at 8 kHz");

    reson_impulse(8000.0f, 1.0f, (int)(1.6f * MOVEFORGE_SAMPLE_RATE));
    float reson_measured = reson_t60((int)(1.6f * MOVEFORGE_SAMPLE_RATE), 8000.0f);
    require_true(reson_measured > 0.9f,
                 "the resonator holds a 1 s tail at 8 kHz, which the SVF cannot");
}

static void test_reson_never_overshoots_unity(void) {
    /* b0 = sin(w) is a normalization, so a unit impulse must not produce a peak
     * above 1 anywhere in the range — that is what lets a bank of ten sum
     * predictably. It only *reaches* 1 when the mode has room to ring, so the
     * lower bound is asserted separately below. */
    for (float hz = 40.0f; hz < MOVEFORGE_SAMPLE_RATE * 0.45f; hz *= 1.3f) {
        for (float t60 = 0.005f; t60 <= 4.01f; t60 *= 3.0f) {
            int n = (int)(fminf(t60 * 1.2f + 0.05f, 5.0f) * MOVEFORGE_SAMPLE_RATE);
            reson_impulse(hz, t60, n);
            float peak = 0.0f;
            for (int i = 0; i < n; i++) {
                if (absf_local(reson_buf[i]) > peak) peak = absf_local(reson_buf[i]);
            }
            if (peak > 1.0f) {
                fprintf(stderr, "FAIL: %.0f Hz T60 %.3f s peaked at %.4f\n", hz, t60, peak);
                exit(1);
            }
            if (!isfinite(peak)) {
                fprintf(stderr, "FAIL: %.0f Hz T60 %.3f s went non-finite\n", hz, t60);
                exit(1);
            }
        }
    }

    /* Given ten cycles to ring, it does reach unity. */
    reson_impulse(1000.0f, 0.05f, (int)(0.1f * MOVEFORGE_SAMPLE_RATE));
    float peak = 0.0f;
    for (int i = 0; i < (int)(0.1f * MOVEFORGE_SAMPLE_RATE); i++) {
        if (absf_local(reson_buf[i]) > peak) peak = absf_local(reson_buf[i]);
    }
    require_true(peak > 0.95f, "a resonator with room to ring reaches unit peak");
}

static void test_reson_rings_at_the_frequency_asked_for(void) {
    /* Counting zero crossings of the impulse response: a mode at f crosses zero
     * 2f times a second. Catches a factor-of-two or a missing 2*pi. */
    const float freqs[] = { 220.0f, 1000.0f, 5000.0f };
    for (unsigned f = 0; f < sizeof(freqs) / sizeof(freqs[0]); f++) {
        int n = (int)(0.2f * MOVEFORGE_SAMPLE_RATE);
        reson_impulse(freqs[f], 1.0f, n);
        int crossings = 0;
        for (int i = 1; i < n; i++) {
            if ((reson_buf[i - 1] <= 0.0f) != (reson_buf[i] <= 0.0f)) crossings++;
        }
        float measured = (float)crossings / (2.0f * 0.2f);
        if (absf_local(measured - freqs[f]) > freqs[f] * 0.02f) {
            fprintf(stderr, "FAIL: asked %.0f Hz, rang at %.0f Hz\n", freqs[f], measured);
            exit(1);
        }
    }
}

static void test_reson_audible_gates_what_the_bank_should_skip(void) {
    /* Muting an out-of-range partial rather than letting mf_reson_set clamp it is
     * what stops a rising `tune` sweep from generating partials that move
     * downward. The predicate is the shared statement of that rule. */
    require_true(mf_reson_audible(1000.0f, 1.0f), "an ordinary partial is audible");
    require_true(!mf_reson_audible(MOVEFORGE_SAMPLE_RATE * 0.5f, 1.0f),
                 "a partial at Nyquist is skipped");
    require_true(!mf_reson_audible(30000.0f, 1.0f), "a partial above Nyquist is skipped");
    require_true(!mf_reson_audible(1000.0f, 0.0f), "a silent partial is skipped");
    require_true(!mf_reson_audible(1000.0f, MF_RESON_MIN_GAIN * 0.5f),
                 "a partial below -60 dB is skipped");
    require_true(mf_reson_audible(MOVEFORGE_SAMPLE_RATE * 0.44f, 1.0f),
                 "a partial just inside the limit is kept");

    /* mf_reson_set's own clamps, asserted for what they actually do.
     *
     * The frequency clamp is not about stability — this form is stable at any w.
     * Unclamped, a request above Nyquist wraps: 80 kHz at 44.1 kHz rings at 8200 Hz,
     * i.e. it aliases *downward*, which is precisely how a rising `tune` sweep would
     * generate partials that move down as the knob goes up. So assert it rings at
     * the ceiling instead. */
    int n = (int)(0.05f * MOVEFORGE_SAMPLE_RATE);
    reson_impulse(80000.0f, 0.5f, n);
    int crossings = 0;
    for (int i = 1; i < n; i++) {
        if ((reson_buf[i - 1] <= 0.0f) != (reson_buf[i] <= 0.0f)) crossings++;
    }
    float rang_at = (float)crossings / (2.0f * 0.05f);
    float ceiling = MOVEFORGE_SAMPLE_RATE * MF_RESON_MAX_HZ_FRACTION;
    if (absf_local(rang_at - ceiling) > ceiling * 0.05f) {
        fprintf(stderr, "FAIL: an 80 kHz request rang at %.0f Hz, not the %.0f Hz ceiling\n",
                rang_at, ceiling);
        exit(1);
    }

    /* The T60 clamp is about stability: expf rounds to exactly 1.0f somewhere above
     * 1000 s, and a pole radius of 1 rings forever rather than decaying. */
    reson_impulse(1000.0f, 1.0e6f, (int)(1.0f * MOVEFORGE_SAMPLE_RATE));
    float early = 0.0f, late = 0.0f;
    for (int i = 0; i < 2000; i++) {
        if (absf_local(reson_buf[i]) > early) early = absf_local(reson_buf[i]);
    }
    for (int i = (int)(1.0f * MOVEFORGE_SAMPLE_RATE) - 2000;
         i < (int)(1.0f * MOVEFORGE_SAMPLE_RATE); i++) {
        if (absf_local(reson_buf[i]) > late) late = absf_local(reson_buf[i]);
    }
    require_true(late < early * 0.9f, "an absurd T60 is clamped to something that decays");
}

/* ---------------------------------------------------------------------------
 * mf_exciter_t — noise grains, density and bursts
 * ------------------------------------------------------------------------- */

#define EXCITER_N 132300   /* 3 s */
static float exciter_buf[EXCITER_N];

static void exciter_run(float strike, uint32_t seed, int n) {
    mf_exciter_coeffs_t c;
    mf_exciter_t e;
    mf_exciter_set(&c, strike, MF_EXCITER_UNBOUNDED);
    mf_exciter_init(&e, seed);
    mf_exciter_trigger(&e, &c);
    for (int i = 0; i < n; i++) exciter_buf[i] = mf_exciter_tick(&e, &c);
}

/* How long one excitation lasts: to the last sample above -60 dB of its own peak. */
static float exciter_span(float strike, float max_s) {
    mf_exciter_coeffs_t c;
    mf_exciter_t e;
    mf_exciter_set(&c, strike, max_s);
    mf_exciter_init(&e, 0xABCDu);
    mf_exciter_trigger(&e, &c);
    float peak = 0.0f;
    int n = EXCITER_N;
    for (int i = 0; i < n; i++) {
        exciter_buf[i] = mf_exciter_tick(&e, &c);
        float a = exciter_buf[i] < 0.0f ? -exciter_buf[i] : exciter_buf[i];
        if (a > peak) peak = a;
    }
    if (peak <= 0.0f) return 0.0f;
    int last = 0;
    for (int i = 0; i < n; i++) {
        float a = exciter_buf[i] < 0.0f ? -exciter_buf[i] : exciter_buf[i];
        if (a > peak * 0.001f) last = i;
    }
    return (float)(last + 1) / MOVEFORGE_SAMPLE_RATE;
}

static void test_exciter_fits_inside_the_bound_it_is_given(void) {
    /* `max_s` is what stops an excitation outlasting the event it excites. Without
     * it, a caller's decay control is silently outranked by `strike`: swarf's conga,
     * asked for 10-101 ms across the strike axis, delivered these floors instead —
     *
     *     strike        0.00   0.25   0.44   0.50   0.52   0.70   0.86
     *     floor (ms)    >6000    100     40     50     55     55     70
     *
     * — and at strike 0 never reached -60 dB at any decay setting at all.
     *
     * Two properties, and the second matters as much as the first: a generous bound
     * must be *inert*, or every long shaker and rattle on the axis gets quietly
     * shortened to pay for the fix. Mutation-tested by removing either cap. */
    const float caps[] = { 0.010f, 0.037f, 0.101f };
    for (int i = 0; i <= 20; i++) {
        float strike = (float)i / 20.0f;

        for (int k = 0; k < 3; k++) {
            float span = exciter_span(strike, caps[k]);
            /* 1.25x: the envelope figure is a time to -40 dB and the bursts land on
             * top of its tail, so the two shares of the budget do not sum exactly.
             * The floors above are 3-10x, so nothing near a real regression fits
             * inside this. */
            if (span > caps[k] * 1.25f) {
                fprintf(stderr, "FAIL: strike %.2f bounded to %.0f ms still excites for "
                                "%.1f ms\n", strike, caps[k] * 1000.0f, span * 1000.0f);
                exit(1);
            }
        }

        /* Inert where there is room: 4 s is longer than the 216 ms worst case. */
        float loose = exciter_span(strike, 4.0f);
        float none = exciter_span(strike, MF_EXCITER_UNBOUNDED);
        if (loose != none) {
            fprintf(stderr, "FAIL: strike %.2f bounded to 4 s spans %.1f ms but is "
                            "%.1f ms unbounded — the cap is not inert\n",
                    strike, loose * 1000.0f, none * 1000.0f);
            exit(1);
        }
    }
}

static void test_a_bounded_exciter_still_makes_grains(void) {
    /* Shortening the window without tightening the grain spacing does not compress a
     * rattle, it empties one. At strike 0 the grains are 500 samples apart, so a
     * voice bounded to a 19 ms decay gets a 6.6 ms window that more often than not
     * contains no grain at all — a hit that is not quieter but *silent*, which is a
     * worse failure than the floor the bound exists to remove. Found by swarf's own
     * conga going silent under exactly that setting.
     *
     * Every seed, not an average: this fails intermittently or not at all, so an
     * averaged assertion would pass a build that is silent one hit in four.
     * Mutation-tested by dropping the `period *= squeeze`. */
    const float caps[] = { 0.010f, 0.019f, 0.037f };
    for (int i = 0; i <= 20; i++) {
        float strike = (float)i / 20.0f;
        for (int k = 0; k < 3; k++) {
            for (uint32_t seed = 1; seed <= 16; seed++) {
                mf_exciter_coeffs_t c;
                mf_exciter_t e;
                mf_exciter_set(&c, strike, caps[k]);
                mf_exciter_init(&e, seed);
                mf_exciter_trigger(&e, &c);
                int grains = 0;
                int n = (int)(caps[k] * MOVEFORGE_SAMPLE_RATE);
                for (int j = 0; j < n; j++) {
                    if (mf_exciter_tick(&e, &c) != 0.0f) grains++;
                }
                if (grains == 0) {
                    fprintf(stderr, "FAIL: strike %.2f bounded to %.0f ms produced no "
                                    "grains at all on seed %u — the hit is silent\n",
                            strike, caps[k] * 1000.0f, seed);
                    exit(1);
                }
            }
        }
    }
}

static void test_exciter_output_stays_bounded(void) {
    /* The contract that lets this compose with everything else here. Measured
     * worst case is 0.994 across the axis; anything above 1 means a caller's gain
     * staging is being decided by this block instead of by the caller. */
    for (int i = 0; i <= 20; i++) {
        float strike = (float)i / 20.0f;
        for (uint32_t seed = 1; seed <= 8; seed++) {
            exciter_run(strike, seed * 2654435761u, EXCITER_N);
            for (int k = 0; k < EXCITER_N; k++) {
                if (!isfinite(exciter_buf[k]) || absf_local(exciter_buf[k]) > 1.0f) {
                    fprintf(stderr, "FAIL: strike %.2f seed %u produced %.4f\n",
                            strike, seed, exciter_buf[k]);
                    exit(1);
                }
            }
        }
    }
}

static void test_exciter_density_spreads_grains_in_time(void) {
    /* strike 0.5 is continuous noise; below it the grains thin out. Asserted as a
     * monotone fall in the fraction of nonzero samples, which is what "density"
     * means and what the resonator bank is being fed. */
    float prev = 2.0f;
    for (int i = 10; i >= 0; i--) {
        float strike = (float)i / 20.0f;
        int n = (int)(0.02f * MOVEFORGE_SAMPLE_RATE);   /* inside every envelope */
        exciter_run(strike, 0x5EEDu, n);
        int nonzero = 0;
        for (int k = 0; k < n; k++) if (exciter_buf[k] != 0.0f) nonzero++;
        float fraction = (float)nonzero / (float)n;
        require_true(fraction <= prev + 0.02f, "grain density falls monotonically");
        prev = fraction;
    }
    require_true(prev < 0.05f, "the sparse end really is sparse");

    exciter_run(0.5f, 0x5EEDu, 64);
    int dense = 0;
    for (int k = 0; k < 64; k++) if (exciter_buf[k] != 0.0f) dense++;
    require_true(dense == 64, "strike 0.5 is continuous, with no gaps at all");
}

static void test_exciter_grains_are_not_periodic(void) {
    /* A counter-based decimator would put a tone where the noise should be: at one
     * grain per 500 samples that is an 88 Hz buzz, which is exactly not a shaker.
     * Geometric spacing has a standard deviation about equal to its mean; a
     * periodic one would read 0. */
    int n = (int)(0.05f * MOVEFORGE_SAMPLE_RATE);
    exciter_run(0.2f, 0x5EEDu, n);

    int last = -1, count = 0;
    double sum = 0.0, sumsq = 0.0;
    for (int i = 0; i < n; i++) {
        if (exciter_buf[i] == 0.0f) continue;
        if (last >= 0) {
            double gap = (double)(i - last);
            sum += gap;
            sumsq += gap * gap;
            count++;
        }
        last = i;
    }
    require_true(count > 20, "enough grains to measure their spacing");
    double mean = sum / count;
    double sd = sqrt(sumsq / count - mean * mean);
    require_true(sd > mean * 0.6, "grain spacing is stochastic, not a fixed period");
}

static void test_exciter_envelope_lengthens_as_grains_thin(void) {
    /* The other half of what `strike` means: a rattle is a long sprinkle, a strike
     * is one short broadband event. */
    float prev = 0.0f;
    for (int i = 10; i >= 0; i--) {
        float strike = (float)i / 20.0f;
        exciter_run(strike, 0x5EEDu, EXCITER_N);
        float peak = 0.0f;
        for (int k = 0; k < EXCITER_N; k++) {
            if (absf_local(exciter_buf[k]) > peak) peak = absf_local(exciter_buf[k]);
        }
        float len = 0.0f;
        for (int k = EXCITER_N - 1; k >= 0; k--) {
            if (absf_local(exciter_buf[k]) > peak * 0.01f) {
                len = (float)k / MOVEFORGE_SAMPLE_RATE;
                break;
            }
        }
        require_true(len >= prev - 0.002f, "the envelope lengthens as grains thin out");
        prev = len;
    }
    require_true(prev > 0.08f, "the rattle end sustains for at least 80 ms");

    exciter_run(0.5f, 0x5EEDu, EXCITER_N);
    float peak = 0.0f;
    for (int k = 0; k < EXCITER_N; k++) {
        if (absf_local(exciter_buf[k]) > peak) peak = absf_local(exciter_buf[k]);
    }
    int last_loud = 0;
    for (int k = EXCITER_N - 1; k >= 0; k--) {
        if (absf_local(exciter_buf[k]) > peak * 0.01f) { last_loud = k; break; }
    }
    require_true((float)last_loud / MOVEFORGE_SAMPLE_RATE < 0.005f,
                 "a centred strike is one short event, not a sprinkle");
}

static void test_exciter_bursts_are_separate_events(void) {
    /* strike above 0.5 must produce distinct hits in time — a flam, then a
     * ratchet. Counted as re-peaks of a smoothed envelope, which is what a
     * listener hears as separate events. */
    mf_exciter_coeffs_t c;
    mf_exciter_set(&c, 1.0f, MF_EXCITER_UNBOUNDED);
    require_true(c.burst_count == MF_EXCITER_MAX_BURSTS, "strike 1 fires every burst");

    int n = (int)(0.1f * MOVEFORGE_SAMPLE_RATE);
    exciter_run(1.0f, 0x5EEDu, n);
    mf_onepole_t lp;
    mf_onepole_init(&lp);
    mf_onepole_set_hz(&lp, 200.0f);
    float env[8192];
    int env_n = n < 8192 ? n : 8192;
    float peak = 0.0f;
    for (int i = 0; i < env_n; i++) {
        env[i] = mf_onepole_tick(&lp, absf_local(exciter_buf[i]));
        if (env[i] > peak) peak = env[i];
    }
    int events = 0;
    for (int i = 1; i < env_n - 1; i++) {
        if (env[i] > peak * 0.1f && env[i] >= env[i - 1] && env[i] > env[i + 1]) {
            events++;
            i += (int)(0.003f * MOVEFORGE_SAMPLE_RATE);
        }
    }
    require_true(events >= 4, "strike 1 produces the first hit plus three bursts");

    /* Bursts fade in by level rather than appearing at full volume, or the knob
     * steps as each one arrives. */
    mf_exciter_coeffs_t low, high;
    mf_exciter_set(&low, 0.55f, MF_EXCITER_UNBOUNDED);
    mf_exciter_set(&high, 0.65f, MF_EXCITER_UNBOUNDED);
    require_true(low.burst_count == 1 && high.burst_count == 1,
                 "the first extra burst arrives before the second");
    require_true(high.burst_level[0] > low.burst_level[0] * 1.5f,
                 "a burst fades in by level as the knob rises");

    /* And they tighten up, flam to ratchet. */
    require_true(high.burst_spacing < low.burst_spacing, "burst spacing tightens");

    /* Below centre there are no bursts at all: that half of the axis is grains. */
    mf_exciter_coeffs_t centre;
    mf_exciter_set(&centre, 0.5f, MF_EXCITER_UNBOUNDED);
    require_true(centre.burst_count == 0, "the rattle half fires no bursts");
    mf_exciter_set(&centre, 0.2f, MF_EXCITER_UNBOUNDED);
    require_true(centre.burst_count == 0, "the rattle half fires no bursts");

    /* A burst raises the envelope rather than replacing it. That only differs when
     * the previous burst is still ringing when the next one lands, which needs the
     * envelope to be longer than the burst spacing — so it cannot happen at a fixed
     * `strike`, only when the control moves during a hit. Which it does: the whole
     * point of this engine is automation lanes.
     *
     * Triggered at strike 0.9 (bursts at 0.794, 0.630, 0.200, 9.8 ms apart) and then
     * ticked with strike 0.05's 122 ms envelope, the third burst lands at 0.200 while
     * the envelope is still at 0.457. Assignment would drop it by more than half,
     * mid-hit, which is a click. */
    mf_exciter_coeffs_t fired, held;
    mf_exciter_t moving;
    mf_exciter_set(&fired, 0.9f, MF_EXCITER_UNBOUNDED);
    mf_exciter_set(&held, 0.05f, MF_EXCITER_UNBOUNDED);
    mf_exciter_init(&moving, 0x5EEDu);
    mf_exciter_trigger(&moving, &fired);
    /* Keep the burst schedule from `fired` but the long envelope from `held`. */
    held.burst_count = fired.burst_count;
    held.burst_spacing = fired.burst_spacing;
    for (int k = 0; k < MF_EXCITER_MAX_BURSTS; k++) held.burst_level[k] = fired.burst_level[k];

    float previous_env = moving.env;
    int saw_a_burst = 0;
    for (int i = 0; i < (int)(0.05f * MOVEFORGE_SAMPLE_RATE); i++) {
        int before = moving.bursts_left;
        mf_exciter_tick(&moving, &held);
        if (moving.bursts_left != before) saw_a_burst = 1;
        if (moving.env < previous_env * 0.99f) {
            fprintf(stderr, "FAIL: envelope fell from %.4f to %.4f in one sample\n",
                    previous_env, moving.env);
            exit(1);
        }
        previous_env = moving.env;
    }
    require_true(saw_a_burst, "the moving-control case actually fired a burst");
}

static void test_exciter_is_deterministic_and_idles(void) {
    /* Renders have to be reproducible, so the same seed must give the same hit. */
    int n = (int)(0.05f * MOVEFORGE_SAMPLE_RATE);
    exciter_run(0.3f, 0xA5A5u, n);
    static float first[8192];
    int keep = n < 8192 ? n : 8192;
    for (int i = 0; i < keep; i++) first[i] = exciter_buf[i];
    exciter_run(0.3f, 0xA5A5u, n);
    for (int i = 0; i < keep; i++) {
        require_true(exciter_buf[i] == first[i], "the same seed gives the same hit");
    }

    /* Different seeds must not: six voices sharing one seed is how six hits sum
     * coherently and sound like one loud hit. */
    exciter_run(0.3f, 0x1234u, n);
    int differences = 0;
    for (int i = 0; i < keep; i++) if (exciter_buf[i] != first[i]) differences++;
    require_true(differences > keep / 10, "a different seed gives a different hit");

    /* Idle is reported, so a voice can skip its sample loop. */
    mf_exciter_coeffs_t c;
    mf_exciter_t e;
    mf_exciter_set(&c, 0.5f, MF_EXCITER_UNBOUNDED);
    mf_exciter_init(&e, 1u);
    require_true(mf_exciter_is_idle(&e, 1.0e-4f), "a fresh exciter is idle");
    mf_exciter_trigger(&e, &c);
    require_true(!mf_exciter_is_idle(&e, 1.0e-4f), "a triggered exciter is not idle");
    for (int i = 0; i < (int)(0.05f * MOVEFORGE_SAMPLE_RATE); i++) mf_exciter_tick(&e, &c);
    require_true(mf_exciter_is_idle(&e, 1.0e-4f), "a spent exciter reports idle");

    /* A pending burst keeps it alive: early-outing between bursts would drop the
     * rest of a clap. */
    mf_exciter_set(&c, 1.0f, MF_EXCITER_UNBOUNDED);
    mf_exciter_init(&e, 1u);
    mf_exciter_trigger(&e, &c);
    for (int i = 0; i < (int)(0.004f * MOVEFORGE_SAMPLE_RATE); i++) mf_exciter_tick(&e, &c);
    require_true(!mf_exciter_is_idle(&e, 1.0e-4f),
                 "an exciter with a burst still pending is not idle");
}

int main(void) {
    test_flush_denorm();
    test_sanitize();
    test_wrap_phase();
    test_onepole();
    test_smooth();
    test_ar_envelope();
    test_tanh_approx();
    test_soft_limit();
    test_rng();
    test_voice_held_note_stack();
    test_beats_to_samples();
    test_svf_damping_mapping();
    test_svf_peak_tracks_cutoff();
    test_svf_is_unconditionally_stable();
    test_svf_resonance_direction_and_evenness();
    test_tilt();
    test_fold();
    test_drive();
    test_decay_ends_and_stays_ended();
    test_decay_shape_is_monotone_and_bounded();
    test_decay_ends_are_exact();
    test_decay_taper_evens_out_the_control();
    test_reson_delivers_the_t60_it_is_asked_for();
    test_reson_beats_the_svf_at_holding_a_tail();
    test_reson_never_overshoots_unity();
    test_reson_rings_at_the_frequency_asked_for();
    test_reson_audible_gates_what_the_bank_should_skip();
    test_exciter_output_stays_bounded();
    test_exciter_fits_inside_the_bound_it_is_given();
    test_a_bounded_exciter_still_makes_grains();
    test_exciter_density_spreads_grains_in_time();
    test_exciter_grains_are_not_periodic();
    test_exciter_envelope_lengthens_as_grains_thin();
    test_exciter_bursts_are_separate_events();
    test_exciter_is_deterministic_and_idles();
    printf("mf_dsp shared block tests passed\n");
    return 0;
}

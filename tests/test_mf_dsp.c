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
    printf("mf_dsp shared block tests passed\n");
    return 0;
}

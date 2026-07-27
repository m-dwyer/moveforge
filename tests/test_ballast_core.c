#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "ballast_core.h"

#define FRAMES 4096

static void require_true(int condition, const char *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
}

static float absf_local(float x) { return x < 0.0f ? -x : x; }

static float left[FRAMES];
static float right[FRAMES];

/* Render `frames` and report the loudest sample. */
static float render_peak(ballast_core_t *s, int frames) {
    ballast_process_float(s, NULL, NULL, left, right, frames);
    float peak = 0.0f;
    for (int i = 0; i < frames; i++) {
        require_true(isfinite(left[i]) && isfinite(right[i]), "render output is finite");
        require_true(absf_local(left[i]) <= 1.0f, "left output stays normalized");
        require_true(absf_local(right[i]) <= 1.0f, "right output stays normalized");
        float a = absf_local(left[i]);
        if (a > peak) peak = a;
    }
    return peak;
}

static double render_energy(ballast_core_t *s, int frames) {
    ballast_process_float(s, NULL, NULL, left, right, frames);
    double energy = 0.0;
    for (int i = 0; i < frames; i++) {
        require_true(isfinite(left[i]), "render output is finite");
        energy += (double)left[i] * (double)left[i];
    }
    return energy;
}

static void set(ballast_core_t *s, const char *key, float value) {
    int id = ballast_param_id(key);
    require_true(id >= 0, key);
    ballast_set_param(s, id, value);
}

/* Zero crossings stand in for pitch: same envelope, higher note, more of them. */
static int render_crossings(ballast_core_t *s, int frames) {
    ballast_process_float(s, NULL, NULL, left, right, frames);
    int crossings = 0;
    for (int i = 1; i < frames; i++) {
        if ((left[i - 1] < 0.0f) != (left[i] < 0.0f)) crossings++;
    }
    return crossings;
}

int main(void) {
    ballast_core_t synth;
    ballast_init(&synth);

    int volume_id = ballast_param_id("volume");
    ballast_set_param(&synth, volume_id, 2.0f);
    require_true(ballast_get_param(&synth, volume_id) <= 1.0f, "volume clamps high");
    ballast_set_param(&synth, volume_id, -1.0f);
    require_true(ballast_get_param(&synth, volume_id) >= 0.0f, "volume clamps low");

    require_true(ballast_param_id("volume") >= 0, "param lookup works");
    require_true(ballast_param_id("does_not_exist") < 0, "unknown param lookup fails");

    /* A trigger makes sound. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    ballast_note_on(&synth, 36, 1.0f);
    require_true(render_peak(&synth, FRAMES) > 0.001f, "note-on render is not silent");

    /* Volume zero mutes, and mutes completely rather than leaving a tail. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 3.0f);
    ballast_note_on(&synth, 36, 1.0f);
    render_peak(&synth, FRAMES);
    set(&synth, "volume", 0.0f);
    render_peak(&synth, FRAMES);            /* let the gain smoother collapse */
    require_true(render_peak(&synth, FRAMES) < 0.0001f, "volume zero mutes a sounding hit");

    /* Changing a control while the voice is IDLE must still take effect on the
     * next hit. The idle early-out skips the sample loop, so anything ramped
     * inside it stops tracking while silent — without an explicit snap on
     * note-on, a Ballast muted between hits still fires its whole transient at
     * -13 dBFS. Distinct from muting a *sounding* note, which the test above
     * covers and which cannot catch this. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 0.05f);
    ballast_note_on(&synth, 36, 1.0f);
    for (int block = 0; block < 8; block++) render_energy(&synth, FRAMES);
    set(&synth, "volume", 0.0f);            /* muted while idle */
    ballast_note_on(&synth, 36, 1.0f);
    require_true(render_peak(&synth, FRAMES) < 0.0001f,
                 "volume set while idle applies to the next hit");

    /* And the inverse: turning volume up while idle must not leave the next hit
     * quiet. */
    ballast_init(&synth);
    set(&synth, "volume", 0.05f);
    set(&synth, "decay", 0.05f);
    ballast_note_on(&synth, 36, 1.0f);
    for (int block = 0; block < 8; block++) render_energy(&synth, FRAMES);
    set(&synth, "volume", 1.0f);
    ballast_note_on(&synth, 36, 1.0f);
    require_true(render_peak(&synth, FRAMES) > 0.15f,
                 "volume raised while idle applies to the next hit");

    /* One-shot: the hit decays on its own, with no note-off involved. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 0.1f);
    ballast_note_on(&synth, 36, 1.0f);
    double first = render_energy(&synth, FRAMES);
    double later = render_energy(&synth, FRAMES);
    require_true(first > 0.01, "one-shot hit has energy");
    require_true(later < first * 0.01, "one-shot hit decays without a note-off");

    /* Note-off is deliberately inert: `decay` owns the length of a hit. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 3.0f);
    ballast_note_on(&synth, 36, 1.0f);
    render_energy(&synth, 256);
    double held = render_energy(&synth, 1024);
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 3.0f);
    ballast_note_on(&synth, 36, 1.0f);
    render_energy(&synth, 256);
    ballast_note_off(&synth, 36);
    double released = render_energy(&synth, 1024);
    require_true(released > held * 0.99, "note-off does not shorten a hit");

    /* Panic still silences. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 3.0f);
    ballast_note_on(&synth, 36, 1.0f);
    render_energy(&synth, 256);
    double sounding = render_energy(&synth, 512);
    ballast_all_notes_off(&synth);
    /* Panic ramps down over the ~0.7 ms declick rather than cutting, and the
     * DC blocker's 17.5 Hz tail outlives that by a few thousand samples at an
     * inaudible level. So: collapse immediately, exact silence shortly after. */
    require_true(render_energy(&synth, 512) < sounding * 0.05,
                 "all-notes-off collapses the output");
    for (int block = 0; block < 4; block++) render_energy(&synth, FRAMES);
    for (int i = 0; i < FRAMES; i++) {
        require_true(left[i] == 0.0f && right[i] == 0.0f,
                     "all-notes-off reaches exact silence");
    }

    /* Decay is the length control. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 0.08f);
    ballast_note_on(&synth, 36, 1.0f);
    double short_energy = render_energy(&synth, FRAMES);
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 1.5f);
    ballast_note_on(&synth, 36, 1.0f);
    double long_energy = render_energy(&synth, FRAMES);
    require_true(long_energy > short_energy * 2.0, "a longer decay renders more energy");

    /* Track turns the fixed-pitch kick into a note-tracked voice. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "track", 0.0f);
    set(&synth, "punch", 0.0f);
    set(&synth, "drop", 0.0f);
    set(&synth, "decay", 1.5f);
    ballast_note_on(&synth, 36, 1.0f);
    int low_fixed = render_crossings(&synth, FRAMES);
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "track", 0.0f);
    set(&synth, "punch", 0.0f);
    set(&synth, "drop", 0.0f);
    set(&synth, "decay", 1.5f);
    ballast_note_on(&synth, 60, 1.0f);
    int high_fixed = render_crossings(&synth, FRAMES);
    require_true(low_fixed == high_fixed, "track zero ignores the note");

    /* Tracking transposes `tune` relative to middle C rather than replacing
     * it, so note 60 is the pivot and lands on `tune` at every track setting.
     * An octave above the pivot must come out an octave up. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "track", 1.0f);
    set(&synth, "punch", 0.0f);
    set(&synth, "drop", 0.0f);
    set(&synth, "decay", 1.5f);
    ballast_note_on(&synth, 72, 1.0f);
    int octave_tracked = render_crossings(&synth, FRAMES);
    require_true(octave_tracked > high_fixed * 3 / 2, "track one follows the note");

    /* Every drive curve stays finite and inside full scale when pushed. */
    for (int curve = 0; curve < 5; curve++) {
        ballast_init(&synth);
        set(&synth, "volume", 1.0f);
        set(&synth, "drive", 1.0f);
        set(&synth, "curve", (float)curve);
        set(&synth, "punch", 1.0f);
        set(&synth, "dirt", 1.0f);
        set(&synth, "decay", 1.0f);
        ballast_note_on(&synth, 36, 1.0f);
        float peak = render_peak(&synth, FRAMES);
        require_true(peak > 0.001f, "driven curve is not silent");
    }

    /* Retriggering resets the oscillator phase; the declick ramp is what keeps
     * that from being a step.
     *
     * The discontinuity lands at the boundary BETWEEN two render calls, because
     * MIDI is dispatched between blocks. An earlier version of this test scanned
     * only inside the post-retrigger buffer and so never looked at the one sample
     * pair that matters — it passed with the declick compiled out entirely.
     * Measure across the boundary, with the noise layers off so the phase reset
     * is the only discontinuity available. */
    {
        ballast_core_t d;
        ballast_init(&d);
        set(&d, "volume", 0.8f);
        set(&d, "punch", 0.0f);
        set(&d, "dirt", 0.0f);
        set(&d, "decay", 3.0f);
        set(&d, "phase", 0.25f);
        set(&d, "track", 1.0f);
        ballast_note_on(&d, 36, 1.0f);
        ballast_process_float(&d, NULL, NULL, left, right, 1024);

        float steady = 0.0f;
        for (int i = 1; i < 1024; i++) {
            float step = absf_local(left[i] - left[i - 1]);
            if (step > steady) steady = step;
        }
        float boundary_before = left[1023];

        ballast_note_on(&d, 36, 1.0f);       /* retrigger, same velocity */
        ballast_process_float(&d, NULL, NULL, left, right, 1024);
        float same_vel_step = absf_local(left[0] - boundary_before);
        require_true(same_vel_step < steady * 2.0f,
                     "retrigger does not step the output across the block boundary");

        /* Move's pads are velocity sensitive, so consecutive hits at different
         * velocities are the normal case, not an edge case. The declick has to
         * sit downstream of the velocity gain to cover it — capture it upstream
         * and the output still steps by the whole gain ratio. */
        boundary_before = left[1023];
        ballast_note_on(&d, 36, 0.05f);      /* retrigger, very different velocity */
        ballast_process_float(&d, NULL, NULL, left, right, 1024);
        float vel_change_step = absf_local(left[0] - boundary_before);
        require_true(vel_change_step < steady * 2.0f,
                     "retrigger at a different velocity does not step the output");
    }

    /* Once the tail is gone the voice short-circuits to exact silence. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "decay", 0.05f);
    ballast_note_on(&synth, 36, 1.0f);
    for (int block = 0; block < 8; block++) {
        ballast_process_float(&synth, NULL, NULL, left, right, FRAMES);
    }
    for (int i = 0; i < FRAMES; i++) {
        require_true(left[i] == 0.0f && right[i] == 0.0f, "idle voice renders exact silence");
    }

    /* Human off is deterministic: two instances must agree sample for sample. */
    ballast_core_t a;
    ballast_core_t b;
    ballast_init(&a);
    ballast_init(&b);
    set(&a, "human", 0.0f);
    set(&b, "human", 0.0f);
    ballast_note_on(&a, 36, 1.0f);
    ballast_note_on(&b, 36, 1.0f);
    ballast_process_float(&a, NULL, NULL, left, right, 512);
    float copy[512];
    for (int i = 0; i < 512; i++) copy[i] = left[i];
    ballast_process_float(&b, NULL, NULL, left, right, 512);
    for (int i = 0; i < 512; i++) {
        require_true(left[i] == copy[i], "renders are reproducible with human off");
    }

    /* The -12 dBFS cross-engine gain reference, asserted absolutely.
     *
     * Four Schwung slots sum at unity into one int16 mailbox with no limiter
     * anywhere in the master path, so every engine has to leave the headroom
     * itself. The goldens only say "unchanged" — a bless can walk this away
     * without anything noticing, which is why it belongs in C. */
    ballast_init(&synth);
    ballast_note_on(&synth, 36, 100.0f / 127.0f);
    float ref = render_peak(&synth, FRAMES);
    require_true(ref > 0.20f && ref < 0.29f,
                 "default patch at velocity 100 peaks near -12 dBFS");

    /* Velocity moves timbre, not only level. The noise layers scale with
     * velocity squared, so a soft hit is duller as well as quieter; without
     * that the attack band barely moved and the spectral centroid actually ran
     * backwards. Compare the 2-6 kHz attack band against the hit's own peak,
     * which is level-independent by construction. */
    {
        float rel[2];
        float vels[2] = { 0.25f, 1.0f };
        float peak[2];
        for (int i = 0; i < 2; i++) {
            ballast_init(&synth);
            set(&synth, "vel_depth", 0.8f);
            set(&synth, "punch", 0.6f);
            set(&synth, "dirt", 0.15f);
            ballast_note_on(&synth, 36, vels[i]);
            ballast_process_float(&synth, NULL, NULL, left, right, FRAMES);
            peak[i] = 0.0f;
            for (int n = 0; n < FRAMES; n++) {
                float a = absf_local(left[n]);
                if (a > peak[i]) peak[i] = a;
            }
            float a1 = 0.0f, a2 = 0.0f, b1 = 0.0f, b2 = 0.0f, bpk = 0.0f;
            const float ah = 2.0f * 3.14159265f * 2000.0f / 44100.0f;
            const float al = 2.0f * 3.14159265f * 6000.0f / 44100.0f;
            for (int n = 0; n < 441; n++) {
                a1 += (left[n] - a1) * ah;
                a2 += (a1 - a2) * ah;
                float hp = left[n] - a2;
                b1 += (hp - b1) * al;
                b2 += (b1 - b2) * al;
                if (absf_local(b2) > bpk) bpk = absf_local(b2);
            }
            rel[i] = bpk / (peak[i] + 1e-9f);
        }
        require_true(peak[1] > peak[0] * 1.5f, "velocity moves level");
        require_true(rel[1] > rel[0] * 2.0f, "velocity moves attack brightness, not just level");

        /* vel_depth zero takes velocity out of the picture entirely. */
        ballast_init(&synth);
        set(&synth, "vel_depth", 0.0f);
        ballast_note_on(&synth, 36, 0.2f);
        float quiet = render_peak(&synth, 1024);
        ballast_init(&synth);
        set(&synth, "vel_depth", 0.0f);
        ballast_note_on(&synth, 36, 1.0f);
        float loud = render_peak(&synth, 1024);
        require_true(absf_local(quiet - loud) < 1.0e-6f, "vel_depth zero ignores velocity");
    }

    /* `human` is the one thing a host LFO structurally cannot do, so it has to
     * actually vary. Consecutive hits are not bit-identical even at human = 0
     * (the noise generator keeps running), so compare the spread. */
    {
        double e0[2], e1[2];
        ballast_init(&synth);
        set(&synth, "human", 0.0f);
        set(&synth, "decay", 0.1f);
        for (int i = 0; i < 2; i++) {
            ballast_note_on(&synth, 36, 1.0f);
            e0[i] = render_energy(&synth, FRAMES);
        }
        ballast_init(&synth);
        set(&synth, "human", 1.0f);
        set(&synth, "decay", 0.1f);
        for (int i = 0; i < 2; i++) {
            ballast_note_on(&synth, 36, 1.0f);
            e1[i] = render_energy(&synth, FRAMES);
        }
        double flat = absf_local((float)(e0[1] / e0[0] - 1.0));
        double varied = absf_local((float)(e1[1] / e1[0] - 1.0));
        require_true(flat < 0.02, "hits are consistent with human off");
        require_true(varied > flat * 3.0, "human varies hit to hit");
    }

    /* Parameters must survive being re-issued every block, which is how Route
     * Motion delivers a hold-mode lane. Jump `tone` between its extremes on
     * alternate blocks and require the step at a block boundary to stay in the
     * same league as the signal's own slew. Unsmoothed, tone measured 64x. */
    {
        ballast_init(&synth);
        set(&synth, "volume", 0.8f);
        set(&synth, "decay", 3.0f);
        set(&synth, "punch", 0.0f);
        set(&synth, "dirt", 0.0f);
        ballast_note_on(&synth, 36, 1.0f);

        /* Baseline: the signal's own largest sample-to-sample step, measured
         * in the same 128-frame blocks so the boundary pairs are comparable. */
        float steady = 0.0f;
        float prev_last = 0.0f;
        for (int block = 0; block < 8; block++) {
            ballast_process_float(&synth, NULL, NULL, left, right, 128);
            for (int i = 1; i < 128; i++) {
                float d = absf_local(left[i] - left[i - 1]);
                if (d > steady) steady = d;
            }
            prev_last = left[127];
        }

        float boundary = 0.0f;
        for (int block = 0; block < 24; block++) {
            set(&synth, "tone", (block % 2) ? 1.0f : 0.0f);
            ballast_process_float(&synth, NULL, NULL, left, right, 128);
            float d = absf_local(left[0] - prev_last);
            if (d > boundary) boundary = d;
            prev_last = left[127];
        }
        if (!(boundary < steady * 2.0f)) {
            fprintf(stderr, "  boundary %.6f steady %.6f ratio %.2f\n",
                    boundary, steady, boundary / steady);
        }
        require_true(boundary < steady * 2.0f,
                     "a parameter re-issued every block does not step the output");
    }

    printf("ballast core tests passed\n");
    return 0;
}

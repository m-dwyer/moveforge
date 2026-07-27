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
     * that from being a step. Measured with the noise layers off so the only
     * discontinuity available is the phase reset itself. */
    ballast_init(&synth);
    set(&synth, "volume", 0.8f);
    set(&synth, "punch", 0.0f);
    set(&synth, "dirt", 0.0f);
    set(&synth, "decay", 3.0f);
    set(&synth, "phase", 0.25f);
    ballast_note_on(&synth, 36, 1.0f);
    ballast_process_float(&synth, NULL, NULL, left, right, 1024);
    float quiet_step = 0.0f;
    for (int i = 1; i < 1024; i++) {
        float d = absf_local(left[i] - left[i - 1]);
        if (d > quiet_step) quiet_step = d;
    }
    ballast_note_on(&synth, 36, 1.0f);   /* retrigger mid-decay */
    ballast_process_float(&synth, NULL, NULL, left, right, 1024);
    float retrigger_step = 0.0f;
    for (int i = 1; i < 1024; i++) {
        float d = absf_local(left[i] - left[i - 1]);
        if (d > retrigger_step) retrigger_step = d;
    }
    require_true(retrigger_step < quiet_step * 4.0f + 0.01f,
                 "retrigger does not step the output");

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

    printf("ballast core tests passed\n");
    return 0;
}

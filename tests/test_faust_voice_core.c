#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "faust_voice_core.h"

#define FRAMES 22050  /* 0.5 s @ 44.1 kHz */

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static double rms(const float *buf, int n) {
    double sum = 0.0;
    for (int i = 0; i < n; i++) sum += (double)buf[i] * (double)buf[i];
    return sqrt(sum / (double)n);
}


/* Releasing a note while a lower one is still held must fall back to it, not go
 * silent. All three sound generators tracked a single `active_note` and cleared
 * the gate whenever a note-off matched it, so press A / press B / release B left
 * the voice silent with A still down. Verified on faust_voice before the fix:
 * gate 0, active_note -1. */
static void test_held_note_falls_back(void) {
    faust_voice_core_t v;
    float l[128], r[128];

    faust_voice_init(&v);
    faust_voice_note_on(&v, 60, 1.0f);
    faust_voice_process_float(&v, NULL, NULL, l, r, 128);
    faust_voice_note_on(&v, 64, 1.0f);
    faust_voice_process_float(&v, NULL, NULL, l, r, 128);

    faust_voice_note_off(&v, 64);
    faust_voice_process_float(&v, NULL, NULL, l, r, 128);
    require_true(v.gate > 0.5f, "releasing the upper note leaves the voice sounding");
    require_true(v.active_note == 60, "the still-held lower note takes over");

    faust_voice_note_off(&v, 60);
    faust_voice_process_float(&v, NULL, NULL, l, r, 128);
    require_true(v.gate < 0.5f, "releasing the last held note stops the voice");
    require_true(v.active_note == -1, "no note is tracked once all are released");

    /* Releasing an underlying note must not disturb the sounding one. */
    faust_voice_init(&v);
    faust_voice_note_on(&v, 60, 1.0f);
    faust_voice_note_on(&v, 64, 1.0f);
    faust_voice_note_off(&v, 60);
    require_true(v.gate > 0.5f && v.active_note == 64,
                 "releasing an underlying note leaves the sounding note alone");
    faust_voice_note_off(&v, 64);
    require_true(v.gate < 0.5f, "and then releasing it stops, with no ghost entry");

    /* all-notes-off clears the whole stack, not just the top. */
    faust_voice_init(&v);
    faust_voice_note_on(&v, 60, 1.0f);
    faust_voice_note_on(&v, 64, 1.0f);
    faust_voice_all_notes_off(&v);
    require_true(v.gate < 0.5f && v.active_note == -1, "all-notes-off silences the voice");
    faust_voice_note_off(&v, 60);
    require_true(v.gate < 0.5f, "a stale note-off after all-notes-off does not revive it");
}

int main(void) {
    faust_voice_core_t v;
    static float out_l[FRAMES];
    static float out_r[FRAMES];
    static float in_l[FRAMES];
    static float in_r[FRAMES];

    faust_voice_init(&v);
    require_true(v.fdsp != NULL, "faust dsp allocated");
    for (int i = 0; i < FAUST_VOICE_PARAM_COUNT; i++) {
        require_true(v.zones[i] != NULL, "param zone captured");
    }
    require_true(v.zone_gate != NULL, "gate zone captured");
    require_true(v.zone_freq != NULL, "freq zone captured");
    require_true(v.zone_gain != NULL, "gain zone captured");

    int cutoff_id = faust_voice_param_id("cutoff");
    require_true(cutoff_id >= 0, "cutoff param id resolves");
    require_true(faust_voice_param_id("gate") < 0, "gate is not a moveforge param");

    faust_voice_set_param(&v, cutoff_id, 0.7f);
    faust_voice_set_param(&v, faust_voice_param_id("level"), 0.8f);

    /* No note held: must be silent. */
    faust_voice_process_float(&v, in_l, in_r, out_l, out_r, FRAMES);
    require_true(rms(out_l, FRAMES) < 1e-4, "no signal before note_on");

    /* Note on: should produce signal. */
    faust_voice_note_on(&v, 60, 1.0f);
    require_true(v.active_note == 60, "note tracked");
    require_true(v.gate == 1.0f, "gate raised on note_on");
    faust_voice_process_float(&v, in_l, in_r, out_l, out_r, FRAMES);
    double r1 = rms(out_l, FRAMES);
    require_true(r1 > 0.01, "signal present while gate is open");

    faust_voice_set_param(&v, faust_voice_param_id("level"), 0.0f);
    faust_voice_process_float(&v, in_l, in_r, out_l, out_r, FRAMES);
    require_true(rms(out_l, FRAMES) < 1e-4, "level zero mutes held note output");
    require_true(rms(out_r, FRAMES) < 1e-4, "level zero mutes held note right output");

    faust_voice_set_param(&v, faust_voice_param_id("level"), 0.8f);
    faust_voice_process_float(&v, in_l, in_r, out_l, out_r, FRAMES);

    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output finite");
        require_true(out_l[i] <= 1.5f && out_l[i] >= -1.5f, "output bounded");
    }

    /* Note off: gate drops, envelope decays toward zero. After a few render
     * passes the tail RMS should be much lower than the sustained RMS. */
    faust_voice_note_off(&v, 60);
    require_true(v.gate == 0.0f, "gate dropped on matching note_off");
    /* Let the release tail through. release default = 0.3s; render 2s. */
    for (int pass = 0; pass < 4; pass++) {
        faust_voice_process_float(&v, in_l, in_r, out_l, out_r, FRAMES);
    }
    double r2 = rms(out_l, FRAMES);
    require_true(r2 < r1 * 0.05, "signal decays after note_off");

    /* note_off for a different note should not interrupt a held one. */
    faust_voice_note_on(&v, 64, 1.0f);
    faust_voice_note_off(&v, 60);
    require_true(v.active_note == 64, "stray note_off ignored");
    require_true(v.gate == 1.0f, "gate stays high");

    faust_voice_all_notes_off(&v);
    require_true(v.gate == 0.0f, "all_notes_off drops gate");

    faust_voice_destroy(&v);

    test_held_note_falls_back();

    printf("faust_voice core tests passed\n");
    return 0;
}

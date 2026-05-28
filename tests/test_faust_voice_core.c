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

int main(void) {
    faust_voice_core_t v;
    static float out_l[FRAMES];
    static float out_r[FRAMES];
    static float in_l[FRAMES];
    static float in_r[FRAMES];

    faust_voice_init(&v);
    require_true(v.fdsp != NULL, "faust dsp allocated");
    for (int i = 0; i < 5; i++) {
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
    printf("faust_voice core tests passed\n");
    return 0;
}

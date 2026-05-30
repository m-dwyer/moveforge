#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "westfold_core.h"
#include "westfold_presets.gen.inc"

#define FRAMES 4096
#define TAIL_FRAMES 65536

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static float absf_local(float x) {
    return x < 0.0f ? -x : x;
}

int main(void) {
    westfold_core_t synth;
    float left[FRAMES];
    float right[FRAMES];
    float tail_left[TAIL_FRAMES];
    float tail_right[TAIL_FRAMES];
    westfold_init(&synth);

    int volume_id = westfold_param_id("volume");
    int decay_id = westfold_param_id("decay");
    int fold_id = westfold_param_id("fold");
    int drive_id = westfold_param_id("drive");
    int strike_id = westfold_param_id("strike");
    int chaos_id = westfold_param_id("chaos");
    int sustain_id = westfold_param_id("sustain");

    require_true(westfold_preset_count() == 10, "preset count is exposed");
    require_true(westfold_preset_name(2)[0] == 'R', "preset name is exposed");
    westfold_apply_preset(&synth, 2);
    require_true(westfold_get_param(&synth, volume_id) > 0.79f, "preset applies volume");
    require_true(westfold_get_param(&synth, fold_id) > 0.67f, "preset applies fold");

    westfold_set_param(&synth, volume_id, 2.0f);
    require_true(westfold_get_param(&synth, volume_id) <= 1.0f, "volume clamps high");

    westfold_set_param(&synth, decay_id, -1.0f);
    require_true(westfold_get_param(&synth, decay_id) >= 0.02f, "decay clamps low");

    westfold_set_param(&synth, drive_id, 2.0f);
    westfold_set_param(&synth, strike_id, -1.0f);
    westfold_set_param(&synth, chaos_id, 2.0f);
    westfold_set_param(&synth, sustain_id, 2.0f);
    require_true(westfold_get_param(&synth, drive_id) <= 1.0f, "drive clamps high");
    require_true(westfold_get_param(&synth, strike_id) >= 0.0f, "strike clamps low");
    require_true(westfold_get_param(&synth, chaos_id) <= 1.0f, "chaos clamps high");
    require_true(westfold_get_param(&synth, sustain_id) <= 1.0f, "sustain clamps high");

    westfold_set_param(&synth, volume_id, 0.8f);
    westfold_set_param(&synth, fold_id, 0.6f);
    westfold_set_param(&synth, drive_id, 0.45f);
    westfold_set_param(&synth, strike_id, 0.7f);
    westfold_set_param(&synth, chaos_id, 0.35f);
    westfold_set_param(&synth, sustain_id, 0.55f);
    westfold_note_on(&synth, 60, 1.0f);
    westfold_process_float(&synth, NULL, NULL, left, right, FRAMES);

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

    westfold_process_float(&synth, NULL, NULL, tail_left, tail_right, TAIL_FRAMES);
    float held_peak = 0.0f;
    for (int i = TAIL_FRAMES - 4096; i < TAIL_FRAMES; i++) {
        float l = absf_local(tail_left[i]);
        if (l > held_peak) held_peak = l;
    }
    require_true(held_peak > 0.001f, "held note sustains before note off");

    westfold_note_off(&synth, 60);
    float before = synth.env;
    westfold_process_float(&synth, NULL, NULL, left, right, FRAMES);
    require_true(synth.env < before, "release envelope decays after note off");

    westfold_process_float(&synth, NULL, NULL, tail_left, tail_right, TAIL_FRAMES);
    float tail_peak_l = 0.0f;
    float tail_peak_r = 0.0f;
    for (int i = TAIL_FRAMES - 4096; i < TAIL_FRAMES; i++) {
        float l = absf_local(tail_left[i]);
        float r = absf_local(tail_right[i]);
        if (l > tail_peak_l) tail_peak_l = l;
        if (r > tail_peak_r) tail_peak_r = r;
    }
    require_true(tail_peak_l < 0.001f, "left release tail reaches silence");
    require_true(tail_peak_r < 0.001f, "right release tail reaches silence");

    require_true(westfold_param_id("fold") >= 0, "param lookup works");
    require_true(westfold_param_id("chaos") >= 0, "new param lookup works");
    require_true(westfold_param_id("does_not_exist") < 0, "unknown param lookup fails");

    printf("westfold core tests passed\n");
    return 0;
}

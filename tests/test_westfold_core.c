#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "westfold_core.h"

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

int main(void) {
    westfold_core_t synth;
    float left[FRAMES];
    float right[FRAMES];
    westfold_init(&synth);

    int volume_id = westfold_param_id("volume");
    int decay_id = westfold_param_id("decay");
    int fold_id = westfold_param_id("fold");

    westfold_set_param(&synth, volume_id, 2.0f);
    require_true(westfold_get_param(&synth, volume_id) <= 1.0f, "volume clamps high");

    westfold_set_param(&synth, decay_id, -1.0f);
    require_true(westfold_get_param(&synth, decay_id) >= 0.02f, "decay clamps low");

    westfold_set_param(&synth, volume_id, 0.8f);
    westfold_set_param(&synth, fold_id, 0.6f);
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

    westfold_note_off(&synth, 60);
    float before = synth.env;
    westfold_process_float(&synth, NULL, NULL, left, right, FRAMES);
    require_true(synth.env < before, "release envelope decays after note off");

    require_true(westfold_param_id("fold") >= 0, "param lookup works");
    require_true(westfold_param_id("does_not_exist") < 0, "unknown param lookup fails");

    printf("westfold core tests passed\n");
    return 0;
}

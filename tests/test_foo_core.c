#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "foo_core.h"

#define FRAMES 4096

static void require_true(int condition, const char *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
}

static float absf_local(float x) { return x < 0.0f ? -x : x; }

int main(void) {
    foo_core_t synth;
    float left[FRAMES];
    float right[FRAMES];
    foo_init(&synth);

    foo_set_param(&synth, FOO_PARAM_VOLUME, 2.0f);
    require_true(foo_get_param(&synth, FOO_PARAM_VOLUME) <= 1.0f, "volume clamps high");

    foo_set_param(&synth, FOO_PARAM_VOLUME, 0.8f);
    foo_note_on(&synth, 60, 1.0f);
    foo_process_float(&synth, NULL, NULL, left, right, FRAMES);

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

    foo_note_off(&synth, 60);
    float before = synth.env;
    foo_process_float(&synth, NULL, NULL, left, right, FRAMES);
    require_true(synth.env < before, "release envelope decays after note off");

    require_true(foo_param_id("volume") == FOO_PARAM_VOLUME, "param lookup works");
    require_true(foo_param_id("does_not_exist") < 0, "unknown param lookup fails");

    printf("foo core tests passed\n");
    return 0;
}

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "foo_core.h"

#define FRAMES 8192

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

int main(void) {
    foo_core_t fx;
    static float in_l[FRAMES];
    static float in_r[FRAMES];
    static float out_l[FRAMES];
    static float out_r[FRAMES];

    foo_init(&fx);

    int time_id = foo_param_id("time");
    int feedback_id = foo_param_id("feedback");
    int mix_id = foo_param_id("mix");

    foo_set_param(&fx, mix_id, 2.0f);
    require_true(foo_get_param(&fx, mix_id) <= 1.0f, "mix clamps high");
    foo_set_param(&fx, feedback_id, -1.0f);
    require_true(foo_get_param(&fx, feedback_id) >= 0.0f, "feedback clamps low");
    foo_set_param(&fx, feedback_id, 2.0f);
    require_true(foo_get_param(&fx, feedback_id) <= 0.95f, "feedback clamps high");

    foo_set_param(&fx, time_id, 0.1f);
    foo_set_param(&fx, feedback_id, 0.4f);
    foo_set_param(&fx, mix_id, 1.0f);

    for (int i = 0; i < FRAMES; i++) {
        in_l[i] = 0.0f;
        in_r[i] = 0.0f;
    }
    in_l[0] = 1.0f;
    in_r[0] = 1.0f;

    foo_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    double tail_energy = 0.0;
    for (int i = 256; i < FRAMES; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
        require_true(out_l[i] <= 1.5f && out_l[i] >= -1.5f, "left output bounded");
        require_true(out_r[i] <= 1.5f && out_r[i] >= -1.5f, "right output bounded");
        tail_energy += (double)out_l[i] * (double)out_l[i];
    }
    require_true(tail_energy > 0.001, "delay tail has energy");

    require_true(foo_param_id("time") >= 0, "param lookup works");
    require_true(foo_param_id("does_not_exist") < 0, "unknown param lookup fails");

    printf("foo core tests passed\n");
    return 0;
}

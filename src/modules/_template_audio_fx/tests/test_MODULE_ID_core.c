#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "MODULE_ID_core.h"

#define FRAMES 512

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

int main(void) {
    MODULE_ID_core_t fx;
    float in_l[FRAMES];
    float in_r[FRAMES];
    float out_l[FRAMES];
    float out_r[FRAMES];

    MODULE_ID_init(&fx);
    MODULE_ID_set_param(&fx, MODULE_UPPER_PARAM_MIX, 2.0f);
    require_true(MODULE_ID_get_param(&fx, MODULE_UPPER_PARAM_MIX) <= 1.0f, "mix clamps high");
    MODULE_ID_set_param(&fx, MODULE_UPPER_PARAM_DRIVE, -1.0f);
    require_true(MODULE_ID_get_param(&fx, MODULE_UPPER_PARAM_DRIVE) >= 0.0f, "drive clamps low");

    MODULE_ID_set_param(&fx, MODULE_UPPER_PARAM_MIX, 0.7f);
    MODULE_ID_set_param(&fx, MODULE_UPPER_PARAM_DRIVE, 0.8f);
    for (int i = 0; i < FRAMES; i++) {
        in_l[i] = i % 2 == 0 ? 0.25f : -0.25f;
        in_r[i] = -in_l[i];
    }

    MODULE_ID_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    double energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
        require_true(out_l[i] <= 1.0f && out_l[i] >= -1.0f, "left output remains normalized");
        require_true(out_r[i] <= 1.0f && out_r[i] >= -1.0f, "right output remains normalized");
        energy += (double)out_l[i] * (double)out_l[i];
    }
    require_true(energy > 0.001, "effect output has energy");
    require_true(MODULE_ID_param_id("tone") == MODULE_UPPER_PARAM_TONE, "param lookup works");
    require_true(MODULE_ID_param_id("does_not_exist") < 0, "unknown param lookup fails");

    printf("MODULE_ID core tests passed\n");
    return 0;
}

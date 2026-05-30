#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "{{moduleId}}_core.h"

#define FRAMES 512

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

int main(void) {
    {{moduleId}}_core_t fx;
    float in_l[FRAMES];
    float in_r[FRAMES];
    float out_l[FRAMES];
    float out_r[FRAMES];

    {{moduleId}}_init(&fx);

    int mix_id = {{moduleId}}_param_id("mix");
    int drive_id = {{moduleId}}_param_id("drive");

    {{moduleId}}_set_param(&fx, mix_id, 2.0f);
    require_true({{moduleId}}_get_param(&fx, mix_id) <= 1.0f, "mix clamps high");
    {{moduleId}}_set_param(&fx, drive_id, -1.0f);
    require_true({{moduleId}}_get_param(&fx, drive_id) >= 0.0f, "drive clamps low");

    {{moduleId}}_set_param(&fx, mix_id, 0.7f);
    {{moduleId}}_set_param(&fx, drive_id, 0.8f);
    for (int i = 0; i < FRAMES; i++) {
        in_l[i] = i % 2 == 0 ? 0.25f : -0.25f;
        in_r[i] = -in_l[i];
    }

    {{moduleId}}_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    double energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
        require_true(out_l[i] <= 1.0f && out_l[i] >= -1.0f, "left output remains normalized");
        require_true(out_r[i] <= 1.0f && out_r[i] >= -1.0f, "right output remains normalized");
        energy += (double)out_l[i] * (double)out_l[i];
    }
    require_true(energy > 0.001, "effect output has energy");
    require_true({{moduleId}}_param_id("tone") >= 0, "param lookup works");
    require_true({{moduleId}}_param_id("does_not_exist") < 0, "unknown param lookup fails");

    printf("{{moduleId}} core tests passed\n");
    return 0;
}

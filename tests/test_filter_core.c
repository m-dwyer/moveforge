#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "filter_core.h"

#define FRAMES 512

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

int main(void) {
    filter_core_t fx;
    float in_l[FRAMES];
    float in_r[FRAMES];
    float out_l[FRAMES];
    float out_r[FRAMES];

    filter_init(&fx);
    require_true(fx.fdsp != NULL, "faust dsp allocated");
    /* Every declared param must have found a matching hslider label in the
     * .dsp. A NULL zone means the label is missing or misspelled, which would
     * otherwise ship as a knob that silently does nothing. */
    for (int i = 0; i < FILTER_PARAM_COUNT; i++) {
        require_true(fx.zones[i] != NULL, "every param zone captured");
    }

    int cutoff_id = filter_param_id("cutoff");
    int resonance_id = filter_param_id("resonance");
    int morph_id = filter_param_id("morph");
    require_true(cutoff_id >= 0 && resonance_id >= 0 && morph_id >= 0, "params resolve");
    require_true(filter_param_id("does_not_exist") < 0, "unknown param fails");

    filter_set_param(&fx, cutoff_id, 2.0f);
    require_true(filter_get_param(&fx, cutoff_id) <= 1.0f, "cutoff clamps high");
    filter_set_param(&fx, resonance_id, -1.0f);
    require_true(filter_get_param(&fx, resonance_id) >= 0.0f, "resonance clamps low");

    for (int i = 0; i < FRAMES; i++) {
        in_l[i] = i % 2 == 0 ? 0.25f : -0.25f;
        in_r[i] = -in_l[i];
    }

    /* Maximum resonance at every filter shape is where an SVF blows up if the
     * trim and the saturator are wrong, so assert the bound there rather than
     * at a comfortable setting. */
    filter_set_param(&fx, resonance_id, 1.0f);
    for (int shape = 0; shape <= 2; shape++) {
        filter_set_param(&fx, cutoff_id, 0.35f);
        filter_set_param(&fx, morph_id, (float)shape * 0.5f);
        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        for (int i = 0; i < FRAMES; i++) {
            require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
            require_true(out_l[i] <= 1.0f && out_l[i] >= -1.0f, "left output remains normalized");
            require_true(out_r[i] <= 1.0f && out_r[i] >= -1.0f, "right output remains normalized");
        }
    }

    filter_set_param(&fx, cutoff_id, 1.0f);
    filter_set_param(&fx, resonance_id, 0.0f);
    filter_set_param(&fx, morph_id, 0.0f);
    filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    double energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        energy += (double)out_l[i] * (double)out_l[i];
    }
    require_true(energy > 0.001, "wide-open lowpass passes signal");

    filter_destroy(&fx);
    printf("filter core tests passed\n");
    return 0;
}

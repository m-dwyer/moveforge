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
    /* Every param the DSP owns must have found a matching hslider label. A
     * NULL zone means the label is missing or misspelled, which would
     * otherwise ship as a knob that silently does nothing. The envelope params
     * are deliberately absent: they are read in C and reach the DSP only
     * through the swept cutoff. */
    require_true(fx.zones[filter_param_id("cutoff")] != NULL, "cutoff zone captured");
    require_true(fx.zones[filter_param_id("resonance")] != NULL, "resonance zone captured");
    require_true(fx.zones[filter_param_id("morph")] != NULL, "morph zone captured");

    int cutoff_id = filter_param_id("cutoff");
    int resonance_id = filter_param_id("resonance");
    int morph_id = filter_param_id("morph");
    require_true(cutoff_id >= 0 && resonance_id >= 0 && morph_id >= 0, "params resolve");
    require_true(filter_param_id("does_not_exist") < 0, "unknown param fails");

    /* Cutoff is declared in hertz and resonance as a Q, so the bounds are the
     * musical ones rather than 0..1. */
    filter_set_param(&fx, cutoff_id, 40000.0f);
    require_true(filter_get_param(&fx, cutoff_id) <= 18000.0f, "cutoff clamps high");
    filter_set_param(&fx, resonance_id, -1.0f);
    require_true(filter_get_param(&fx, resonance_id) >= 0.5f, "resonance clamps low");

    for (int i = 0; i < FRAMES; i++) {
        in_l[i] = i % 2 == 0 ? 0.25f : -0.25f;
        in_r[i] = -in_l[i];
    }

    /* Maximum resonance at every filter shape is where an SVF blows up, and
     * nothing attenuates broadband to hide it: the saturator's ceiling is the
     * only thing holding the peak, so assert that ceiling rather than merely
     * that the output is normalized. */
    filter_set_param(&fx, resonance_id, 20.0f);
    for (int shape = 0; shape <= 2; shape++) {
        filter_set_param(&fx, cutoff_id, 216.0f);
        filter_set_param(&fx, morph_id, (float)shape * 0.5f);
        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        for (int i = 0; i < FRAMES; i++) {
            require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
            require_true(fabsf(out_l[i]) <= 0.9f, "left output stays under the saturator ceiling");
            require_true(fabsf(out_r[i]) <= 0.9f, "right output stays under the saturator ceiling");
        }
    }

    filter_set_param(&fx, cutoff_id, 18000.0f);
    filter_set_param(&fx, resonance_id, 0.5f);
    filter_set_param(&fx, morph_id, 0.0f);
    filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    double energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        energy += (double)out_l[i] * (double)out_l[i];
    }
    require_true(energy > 0.001, "wide-open lowpass passes signal");

    /* The one that catches a cutoff the DSP is not reading.
     *
     * A version that declared hertz to the host while the .dsp still treated
     * the slider as 0..1 sat wide open at every setting, and every param
     * round-trip test above still passed. Energy is the only witness. */
    {
        double open_energy = 0.0;
        double closed_energy = 0.0;
        /* A square at about 2.8 kHz: well inside an open lowpass, well outside
         * one parked at 100 Hz. */
        for (int i = 0; i < FRAMES; i++) {
            in_l[i] = (i / 8) % 2 == 0 ? 0.25f : -0.25f;
            in_r[i] = in_l[i];
        }

        filter_init(&fx);
        filter_set_param(&fx, morph_id, 0.0f);
        filter_set_param(&fx, resonance_id, 0.5f);
        filter_set_param(&fx, cutoff_id, 18000.0f);
        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        for (int i = 0; i < FRAMES; i++) open_energy += (double)out_l[i] * out_l[i];

        filter_init(&fx);
        filter_set_param(&fx, morph_id, 0.0f);
        filter_set_param(&fx, resonance_id, 0.5f);
        filter_set_param(&fx, cutoff_id, 100.0f);
        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        for (int i = 0; i < FRAMES; i++) closed_energy += (double)out_l[i] * out_l[i];

        require_true(open_energy > 0.1, "an open lowpass passes the signal");
        require_true(closed_energy < open_energy * 0.05,
                     "a lowpass parked at 100 Hz removes a 2.8 kHz signal");
    }

    /* The envelope sweeps the cutoff, and only while a note is down. */
    {
        double gated_energy = 0.0;
        double idle_energy = 0.0;

        filter_init(&fx);
        filter_set_param(&fx, morph_id, 0.0f);
        filter_set_param(&fx, resonance_id, 0.5f);
        filter_set_param(&fx, cutoff_id, 100.0f);
        filter_set_param(&fx, filter_param_id("filter_attack"), 0.0f);
        filter_set_param(&fx, filter_param_id("filter_decay"), 4.0f);
        filter_set_param(&fx, filter_param_id("filter_sustain"), 1.0f);
        filter_set_param(&fx, filter_param_id("env_amount"), 8.0f);

        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        for (int i = 0; i < FRAMES; i++) idle_energy += (double)out_l[i] * out_l[i];

        filter_handle_midi(&fx, 0x90, 60, 100);
        /* Two blocks: the first opens the envelope, the second is measured
         * with it already open. */
        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        for (int i = 0; i < FRAMES; i++) gated_energy += (double)out_l[i] * out_l[i];

        require_true(gated_energy > idle_energy * 10.0,
                     "a note sweeps the cutoff up and lets the signal through");

        /* A panic closes it even though no note-off ever arrived. */
        filter_all_notes_off(&fx);
        for (int block = 0; block < 400; block++)
            filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        double released_energy = 0.0;
        for (int i = 0; i < FRAMES; i++) released_energy += (double)out_l[i] * out_l[i];
        require_true(released_energy < gated_energy * 0.1,
                     "a panic closes the envelope with no note-off");
    }

    filter_destroy(&fx);
    printf("filter core tests passed\n");
    return 0;
}

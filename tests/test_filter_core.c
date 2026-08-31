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

        filter_destroy(&fx);
        filter_init(&fx);
        filter_set_param(&fx, morph_id, 0.0f);
        filter_set_param(&fx, resonance_id, 0.5f);
        filter_set_param(&fx, cutoff_id, 18000.0f);
        filter_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);
        for (int i = 0; i < FRAMES; i++) open_energy += (double)out_l[i] * out_l[i];

        filter_destroy(&fx);
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

        filter_destroy(&fx);
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

    /* The swept cutoff moves at least once every 32 frames.
     *
     * filter_adapter.c holds the cutoff still for FILTER_SWEEP_FRAMES and calls
     * the Faust dsp once per sub-block, and its comment sells that as "about
     * 0.7 ms of envelope resolution" — 32 frames at 44.1 kHz. Nothing checked
     * it, and nothing could: rendered at one update per 128-frame block instead,
     * the 05-sweep golden moves rms by 0.004% and every metric in check-renders
     * stays inside tolerance, so the suite is blind to a fourfold coarsening.
     *
     * Sub-dividing is what makes this observable without reaching inside. The
     * sub-block boundaries of one 128-frame call and of four consecutive
     * 32-frame calls coincide exactly when the stride divides 32, so the two
     * must agree sample for sample. Measured against this core, they do at a
     * stride of 1, 8 and 32, and diverge by 0.2 and 0.39 at 64 and 128.
     *
     * The envelope has to be moving for any of this to mean anything. The
     * "a note sweeps the cutoff up" case above is what guards that; were the
     * envelope to stop reaching the cutoff, it would fail first and this would
     * pass on two identically frozen filters. */
    {
        enum { SWEEP_BLOCK = 128, SWEEP_STEP = 32 };
        float sweep_in[SWEEP_BLOCK];
        float whole_l[SWEEP_BLOCK], whole_r[SWEEP_BLOCK];
        float split_l[SWEEP_BLOCK], split_r[SWEEP_BLOCK];
        filter_core_t whole, split;
        filter_core_t *both[2] = { &whole, &split };
        double worst = 0.0;

        for (int i = 0; i < SWEEP_BLOCK; i++)
            sweep_in[i] = 0.7f * sinf(2.0f * 3.14159265f * 1000.0f * (float)i / 44100.0f);

        /* A fast decay from a wide-open cutoff: the sweep crosses several
         * octaves inside the one block under test. */
        for (int c = 0; c < 2; c++) {
            filter_init(both[c]);
            filter_set_param(both[c], cutoff_id, 120.0f);
            filter_set_param(both[c], resonance_id, 8.0f);
            filter_set_param(both[c], morph_id, 0.0f);
            filter_set_param(both[c], filter_param_id("env_amount"), 5.0f);
            filter_set_param(both[c], filter_param_id("filter_attack"), 0.0f);
            filter_set_param(both[c], filter_param_id("filter_decay"), 0.03f);
            filter_set_param(both[c], filter_param_id("filter_sustain"), 0.0f);
            filter_set_param(both[c], filter_param_id("filter_release"), 0.2f);
            filter_handle_midi(both[c], 0x90, 60, 100);
        }

        filter_process_float(&whole, sweep_in, sweep_in, whole_l, whole_r, SWEEP_BLOCK);
        for (int off = 0; off < SWEEP_BLOCK; off += SWEEP_STEP) {
            filter_process_float(&split, sweep_in + off, sweep_in + off,
                                 split_l + off, split_r + off, SWEEP_STEP);
        }

        for (int i = 0; i < SWEEP_BLOCK; i++) {
            double d = fabs((double)whole_l[i] - (double)split_l[i]);
            if (d > worst) worst = d;
        }
        /* Both paths run the identical arithmetic in the identical order, so
         * this is exact in practice; the tolerance is there so a compiler that
         * contracts differently between the two call shapes reports a real
         * coarsening rather than its own rounding. */
        require_true(worst < 1e-6,
                     "the cutoff sweeps at least once every 32 frames");

        filter_destroy(&whole);
        filter_destroy(&split);
    }

    filter_destroy(&fx);
    printf("filter core tests passed\n");
    return 0;
}

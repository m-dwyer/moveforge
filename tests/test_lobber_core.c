#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "lobber_core.h"

#define BLOCK 128

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

/* Alternating ±0.25 test signal (cheap, non-zero, well inside [-1,1]). */
static void fill_signal(float *l, float *r, int n, int phase) {
    for (int i = 0; i < n; i++) {
        l[i] = ((i + phase) % 2 == 0) ? 0.25f : -0.25f;
        r[i] = -l[i];
    }
}

static void set(lobber_core_t *fx, const char *key, float v) {
    lobber_set_param(fx, lobber_param_id(key), v);
}

/* Run one block, asserting every sample stays finite and normalized. */
static double run_block(lobber_core_t *fx, int phase) {
    float in_l[BLOCK], in_r[BLOCK], out_l[BLOCK], out_r[BLOCK];
    fill_signal(in_l, in_r, BLOCK, phase);
    lobber_process_float(fx, in_l, in_r, out_l, out_r, BLOCK);
    double energy = 0.0;
    for (int i = 0; i < BLOCK; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
        require_true(out_l[i] <= 1.0f && out_l[i] >= -1.0f, "left output normalized");
        require_true(out_r[i] <= 1.0f && out_r[i] >= -1.0f, "right output normalized");
        energy += (double)out_l[i] * (double)out_l[i];
    }
    return energy;
}

/* A block whose output must equal the dry input exactly (live passthrough). */
static void require_passthrough(lobber_core_t *fx, int phase, const char *msg) {
    float in_l[BLOCK], in_r[BLOCK], out_l[BLOCK], out_r[BLOCK];
    fill_signal(in_l, in_r, BLOCK, phase);
    lobber_process_float(fx, in_l, in_r, out_l, out_r, BLOCK);
    for (int i = 0; i < BLOCK; i++) {
        require_true(out_l[i] == in_l[i] && out_r[i] == in_r[i], msg);
    }
}

int main(void) {
    /* Core is ~4 MB (embedded ring buffer) — heap, never the stack. */
    lobber_core_t *fx = (lobber_core_t*)malloc(sizeof(*fx));
    require_true(fx != NULL, "core allocates");
    lobber_init(fx);

    /* param lookup + clamping */
    require_true(lobber_param_id("offset") >= 0, "param lookup works");
    require_true(lobber_param_id("does_not_exist") < 0, "unknown param lookup fails");
    set(fx, "mix", 2.0f);
    require_true(lobber_get_param(fx, lobber_param_id("mix")) <= 1.0f, "mix clamps high");
    set(fx, "offset", 99.0f);
    require_true(lobber_get_param(fx, lobber_param_id("offset")) <= 16.0f, "offset clamps high");
    set(fx, "bpm", 10.0f);
    require_true(lobber_get_param(fx, lobber_param_id("bpm")) >= 40.0f, "bpm clamps low");

    /* default state is live passthrough: out == in, bit for bit */
    lobber_init(fx);
    require_passthrough(fx, 0, "default state passes audio through unchanged");

    /* fill the buffer with ~1 s of history so a toss reads real audio */
    lobber_init(fx);
    for (int b = 0; b < 345; b++) run_block(fx, b);

    /* engage tossing via the param: looped 1/16 slice, 2 slices back */
    set(fx, "active", 1.0f);
    set(fx, "offset", 2.0f);
    set(fx, "division", 3.0f);
    set(fx, "loop", 1.0f);
    double e = 0.0;
    for (int b = 0; b < 8; b++) e += run_block(fx, b);
    require_true(e > 0.001, "tossing produces output energy");

    /* reverse + freeze must stay finite/normalized (checked inside run_block) */
    set(fx, "reverse", 1.0f);
    set(fx, "freeze", 1.0f);
    for (int b = 0; b < 8; b++) run_block(fx, b);

    /* release: after the wet envelope falls, we return to exact live passthrough */
    set(fx, "active", 0.0f);
    set(fx, "reverse", 0.0f);
    set(fx, "freeze", 0.0f);
    for (int b = 0; b < 8; b++) run_block(fx, b);          /* let wet_env reach 0 */
    require_passthrough(fx, 0, "releasing the toss returns to live audio");

    /* MIDI: a note holds a toss even with the param off; release ends it */
    lobber_init(fx);
    for (int b = 0; b < 345; b++) run_block(fx, b);        /* refill history */
    lobber_handle_midi(fx, 0x90, 72, 100);               /* note on */
    require_true(fx->pad_held == 1, "note on holds a toss");
    for (int b = 0; b < 8; b++) run_block(fx, b);
    lobber_handle_midi(fx, 0x80, 72, 0);                 /* note off */
    require_true(fx->pad_held == 0, "note off releases the toss");
    /* a stale note-off must not cancel an active hold */
    lobber_handle_midi(fx, 0x90, 74, 100);
    lobber_handle_midi(fx, 0x80, 60, 0);
    require_true(fx->pad_held == 1, "stale note off is ignored");

    /* --- step-length grid matches the device note keys, not the old 1/32 --- */
    lobber_init(fx);
    set(fx, "bpm", 120.0f);
    int sl[6];
    for (int d = 0; d < 6; d++) {
        set(fx, "division", (float)d);
        sl[d] = lobber_slice_samples(fx);
    }
    require_true(sl[0] > sl[1] && sl[1] > sl[2], "regular grid descends 1/4>1/8>1/16");
    /* each triplet is 2/3 of its straight note: straight/triplet ratio == 3/2 */
    require_true(abs(sl[0] - sl[3] * 3 / 2) <= 2, "div 3 is 1/4T (2/3 of 1/4)");
    require_true(abs(sl[1] - sl[4] * 3 / 2) <= 2, "div 4 is 1/8T (2/3 of 1/8)");
    require_true(abs(sl[2] - sl[5] * 3 / 2) <= 2, "div 5 is 1/16T (2/3 of 1/16)");
    /* the old 1/32 would be half of 1/16; 1/16T is two-thirds, so clearly larger */
    require_true(sl[5] > sl[2] / 2 + 1, "div 5 is 1/16T, not the retired 1/32");

    /* --- Loop mode: plays the captured loop with no live input; stop silences --- */
    lobber_init(fx);
    set(fx, "bpm", 120.0f);
    for (int b = 0; b < 345; b++) run_block(fx, b);      /* ~1 s of history */
    set(fx, "loop_beats", 2.0f);
    set(fx, "capture", 1.0f); run_block(fx, 0);          /* rising edge -> snapshot */
    set(fx, "capture", 0.0f);
    set(fx, "mode", 1.0f);                               /* Loop */
    {
        float zl[BLOCK] = {0}, zr[BLOCK] = {0}, ol[BLOCK], orr[BLOCK];
        double le = 0.0;
        for (int b = 0; b < 8; b++) {
            lobber_process_float(fx, zl, zr, ol, orr, BLOCK);   /* silent live input */
            for (int i = 0; i < BLOCK; i++) {
                require_true(isfinite(ol[i]) && ol[i] <= 1.0f && ol[i] >= -1.0f,
                             "loop output normalized");
                le += (double)ol[i] * ol[i];
            }
        }
        require_true(le > 0.001, "loop mode plays the captured loop without live input");

        lobber_set_transport(fx, 0);                     /* transport stopped */
        for (int b = 0; b < 200; b++) lobber_process_float(fx, zl, zr, ol, orr, BLOCK);
        double se = 0.0;
        for (int i = 0; i < BLOCK; i++) se += (double)ol[i] * ol[i];
        require_true(se < 1e-6, "transport-stopped loop is silent");
        lobber_set_transport(fx, 1);
    }
    /* time-stretch: a loop captured at 120 BPM still plays, finite + normalized,
     * when the tempo changes (the varispeed read rate is no longer 1.0) */
    set(fx, "bpm", 90.0f);
    {
        float zl[BLOCK] = {0}, zr[BLOCK] = {0}, ol[BLOCK], orr[BLOCK];
        double te = 0.0;
        for (int b = 0; b < 16; b++) {
            lobber_process_float(fx, zl, zr, ol, orr, BLOCK);
            for (int i = 0; i < BLOCK; i++) {
                require_true(isfinite(ol[i]) && ol[i] <= 1.0f && ol[i] >= -1.0f,
                             "tempo-stretched loop normalized");
                te += (double)ol[i] * ol[i];
            }
        }
        require_true(te > 0.001, "loop still plays after a tempo change");
    }

    /* --- Slice mode: live passthrough when idle, one-shot slice when triggered --- */
    lobber_init(fx);
    set(fx, "bpm", 120.0f);
    for (int b = 0; b < 345; b++) run_block(fx, b);
    set(fx, "loop_beats", 2.0f);
    set(fx, "capture", 1.0f); run_block(fx, 0);
    set(fx, "capture", 0.0f);
    set(fx, "mode", 2.0f);                               /* Slice */
    set(fx, "division", 2.0f);                           /* 1/16 slices */
    set(fx, "active", 0.0f);
    require_passthrough(fx, 0, "slice mode passes live audio when idle");
    set(fx, "offset", 1.0f);
    set(fx, "active", 1.0f);                             /* fire a slice */
    double sse = 0.0;
    for (int b = 0; b < 4; b++) sse += run_block(fx, b);
    require_true(sse > 0.001, "slice mode triggers a slice with energy");
    set(fx, "mute", 1.0f);                               /* dry muted, stays finite */
    for (int b = 0; b < 4; b++) run_block(fx, b);
    set(fx, "mute", 0.0f);
    set(fx, "active", 0.0f);

    /* --- function-row MIDI on channel 1 drives mode/mute/reverse --- */
    lobber_init(fx);
    lobber_handle_midi(fx, 0x91, 0, 100);               /* MODE: Live -> Loop */
    require_true((int)(lobber_get_param(fx, lobber_param_id("mode")) + 0.5f) == 1,
                 "fn key cycles mode to Loop");
    lobber_handle_midi(fx, 0x91, 0, 100);               /* -> Slice */
    lobber_handle_midi(fx, 0x91, 0, 100);               /* -> wraps to Live */
    require_true((int)(lobber_get_param(fx, lobber_param_id("mode")) + 0.5f) == 0,
                 "fn key wraps mode back to Live");
    lobber_handle_midi(fx, 0x91, 3, 100);               /* MUTE toggle on */
    require_true(lobber_get_param(fx, lobber_param_id("mute")) >= 0.5f, "fn key toggles mute on");
    lobber_handle_midi(fx, 0x91, 3, 100);               /* MUTE toggle off */
    require_true(lobber_get_param(fx, lobber_param_id("mute")) < 0.5f, "fn key toggles mute off");
    lobber_handle_midi(fx, 0x91, 1, 100);              /* REVERSE held */
    require_true(fx->midi_reverse_held == 1, "fn key holds reverse on note-on");
    lobber_handle_midi(fx, 0x91, 1, 0);               /* REVERSE released */
    require_true(fx->midi_reverse_held == 0, "fn key releases reverse on note-off");
    lobber_handle_midi(fx, 0x90, 73, 100);             /* channel 0 still tosses */
    require_true(fx->pad_held == 1 && fx->pad_offset == 73 % 16,
                 "channel-0 note still maps to a toss offset");

    free(fx);
    printf("lobber core tests passed\n");
    return 0;
}

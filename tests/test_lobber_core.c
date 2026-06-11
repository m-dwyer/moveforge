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

    free(fx);
    printf("lobber core tests passed\n");
    return 0;
}

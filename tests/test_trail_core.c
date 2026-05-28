#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "trail_core.h"

#define FRAMES 32768

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static float peak_abs(const float *x, int from, int to) {
    float m = 0.0f;
    for (int i = from; i < to; i++) {
        float a = fabsf(x[i]);
        if (a > m) m = a;
    }
    return m;
}

int main(void) {
    trail_core_t fx;
    static float in_l[FRAMES];
    static float in_r[FRAMES];
    static float out_l[FRAMES];
    static float out_r[FRAMES];

    trail_init(&fx);

    int time_id = trail_param_id("time");
    int sync_id = trail_param_id("sync");
    int feedback_id = trail_param_id("feedback");
    int mix_id = trail_param_id("mix");
    int tone_id = trail_param_id("tone");
    int mod_id = trail_param_id("mod");
    int width_id = trail_param_id("width");
    int drive_id = trail_param_id("drive");
    int space_id = trail_param_id("space");

    /* Param clamping. */
    trail_set_param(&fx, mix_id, 2.0f);
    require_true(trail_get_param(&fx, mix_id) <= 1.0f, "mix clamps high");
    trail_set_param(&fx, feedback_id, -1.0f);
    require_true(trail_get_param(&fx, feedback_id) >= 0.0f, "feedback clamps low");
    trail_set_param(&fx, feedback_id, 2.0f);
    require_true(trail_get_param(&fx, feedback_id) <= 0.95f, "feedback clamps high");
    trail_set_param(&fx, sync_id, 20.0f);
    require_true(trail_get_param(&fx, sync_id) <= 9.0f, "sync clamps high");
    trail_set_param(&fx, sync_id, -3.0f);
    require_true(trail_get_param(&fx, sync_id) >= 0.0f, "sync clamps low");
    trail_set_param(&fx, tone_id, 5.0f);
    require_true(trail_get_param(&fx, tone_id) <= 1.0f, "tone clamps high");
    trail_set_param(&fx, mod_id, 5.0f);
    require_true(trail_get_param(&fx, mod_id) <= 1.0f, "mod clamps high");
    trail_set_param(&fx, width_id, 5.0f);
    require_true(trail_get_param(&fx, width_id) <= 1.0f, "width clamps high");
    trail_set_param(&fx, drive_id, 5.0f);
    require_true(trail_get_param(&fx, drive_id) <= 1.0f, "drive clamps high");
    trail_set_param(&fx, space_id, 5.0f);
    require_true(trail_get_param(&fx, space_id) <= 1.0f, "space clamps high");

    require_true(trail_param_id("time") >= 0, "param lookup works");
    require_true(trail_param_id("does_not_exist") < 0, "unknown param lookup fails");

    /* Free-mode feedback tail: an impulse should leave audible, finite,
     * bounded energy in the tail. */
    trail_set_param(&fx, sync_id, 0.0f);
    trail_set_param(&fx, time_id, 0.1f);
    trail_set_param(&fx, feedback_id, 0.5f);
    trail_set_param(&fx, tone_id, 0.55f);
    trail_set_param(&fx, mod_id, 0.2f);
    trail_set_param(&fx, width_id, 0.5f);
    trail_set_param(&fx, drive_id, 0.2f);
    trail_set_param(&fx, space_id, 0.3f);
    trail_set_param(&fx, mix_id, 1.0f);

    for (int i = 0; i < FRAMES; i++) { in_l[i] = 0.0f; in_r[i] = 0.0f; }
    in_l[0] = 1.0f;
    in_r[0] = 1.0f;

    trail_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    double tail_energy = 0.0;
    for (int i = 256; i < FRAMES; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
        require_true(out_l[i] <= 1.5f && out_l[i] >= -1.5f, "left output bounded");
        require_true(out_r[i] <= 1.5f && out_r[i] >= -1.5f, "right output bounded");
        tail_energy += (double)out_l[i] * (double)out_l[i];
    }
    require_true(tail_energy > 0.001, "delay tail has energy");

    /* Tempo sync: a single clean tap at 1/4 @ 120 BPM should land near
     * 0.5 s (22050 samples), not before. */
    trail_init(&fx);
    trail_set_tempo(&fx, 120.0f, 1);
    trail_set_param(&fx, sync_id, 5.0f);   /* 1/4 = 1 beat */
    trail_set_param(&fx, feedback_id, 0.0f);
    trail_set_param(&fx, mod_id, 0.0f);
    trail_set_param(&fx, width_id, 0.0f);
    trail_set_param(&fx, space_id, 0.0f);
    trail_set_param(&fx, drive_id, 0.0f);
    trail_set_param(&fx, mix_id, 1.0f);

    for (int i = 0; i < FRAMES; i++) { in_l[i] = 0.0f; in_r[i] = 0.0f; }
    in_l[0] = 1.0f;
    in_r[0] = 1.0f;

    trail_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    int expected = (int)(0.5f * 44100.0f); /* 22050 */
    float at_echo = peak_abs(out_l, expected - 256, expected + 256);
    float before_echo = peak_abs(out_l, 2000, expected - 2000);
    require_true(at_echo > 0.05f, "synced echo present near expected delay");
    require_true(at_echo > before_echo * 4.0f, "synced echo lands at the right time");

    trail_destroy(&fx);

    printf("trail core tests passed\n");
    return 0;
}

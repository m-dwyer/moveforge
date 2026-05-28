#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "faust_drive_core.h"

#define FRAMES 4096

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

int main(void) {
    faust_drive_core_t fx;
    static float in_l[FRAMES];
    static float in_r[FRAMES];
    static float out_l[FRAMES];
    static float out_r[FRAMES];

    faust_drive_init(&fx);
    require_true(fx.fdsp != NULL, "faust dsp allocated");
    for (int i = 0; i < 4; i++) {
        require_true(fx.zones[i] != NULL, "param zone captured by buildUserInterface");
    }

    int drive_id = faust_drive_param_id("drive");
    int tone_id  = faust_drive_param_id("tone");
    int mix_id   = faust_drive_param_id("mix");
    int level_id = faust_drive_param_id("level");
    require_true(drive_id >= 0 && tone_id >= 0 && mix_id >= 0 && level_id >= 0,
                 "param ids resolve");
    require_true(faust_drive_param_id("does_not_exist") < 0, "unknown param fails");

    faust_drive_set_param(&fx, drive_id, 2.0f);
    require_true(faust_drive_get_param(&fx, drive_id) <= 1.0f, "drive clamps high");
    faust_drive_set_param(&fx, drive_id, -1.0f);
    require_true(faust_drive_get_param(&fx, drive_id) >= 0.0f, "drive clamps low");

    faust_drive_set_param(&fx, drive_id, 0.8f);
    faust_drive_set_param(&fx, tone_id,  0.5f);
    faust_drive_set_param(&fx, mix_id,   1.0f);
    faust_drive_set_param(&fx, level_id, 0.8f);

    /* 200 Hz sine at 44.1 kHz */
    for (int i = 0; i < FRAMES; i++) {
        float t = (float)i / 44100.0f;
        float s = sinf(2.0f * 3.14159265f * 200.0f * t) * 0.5f;
        in_l[i] = s;
        in_r[i] = s;
    }

    faust_drive_process_float(&fx, in_l, in_r, out_l, out_r, FRAMES);

    double energy = 0.0;
    for (int i = 256; i < FRAMES; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output finite");
        require_true(out_l[i] <= 1.5f && out_l[i] >= -1.5f, "left bounded");
        require_true(out_r[i] <= 1.5f && out_r[i] >= -1.5f, "right bounded");
        energy += (double)out_l[i] * (double)out_l[i];
    }
    require_true(energy > 0.01, "output has signal energy");

    faust_drive_destroy(&fx);
    printf("faust_drive core tests passed\n");
    return 0;
}

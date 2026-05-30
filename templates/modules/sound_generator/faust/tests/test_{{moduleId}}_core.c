#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "{{moduleId}}_core.h"

#define FRAMES 22050

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static double rms(const float *buf, int n) {
    double sum = 0.0;
    for (int i = 0; i < n; i++) sum += (double)buf[i] * (double)buf[i];
    return sqrt(sum / (double)n);
}

int main(void) {
    {{moduleId}}_core_t v;
    static float out_l[FRAMES];
    static float out_r[FRAMES];

    {{moduleId}}_init(&v);
    require_true(v.fdsp != NULL, "faust dsp allocated");
    require_true(v.zones[0] != NULL, "level zone captured");
    require_true(v.zone_gate != NULL, "gate zone captured");
    require_true(v.zone_freq != NULL, "freq zone captured");
    require_true(v.zone_gain != NULL, "gain zone captured");

    int level_id = {{moduleId}}_param_id("level");
    require_true(level_id >= 0, "level param id resolves");
    require_true({{moduleId}}_param_id("gate") < 0, "gate is not a moveforge param");
    require_true({{moduleId}}_param_id("does_not_exist") < 0, "unknown param fails");

    {{moduleId}}_set_param(&v, level_id, 2.0f);
    require_true({{moduleId}}_get_param(&v, level_id) <= 1.0f, "level clamps high");

    {{moduleId}}_process_float(&v, NULL, NULL, out_l, out_r, FRAMES);
    require_true(rms(out_l, FRAMES) < 1e-4, "no signal before note_on");

    {{moduleId}}_set_param(&v, level_id, 0.8f);
    {{moduleId}}_note_on(&v, 60, 1.0f);
    require_true(v.active_note == 60, "note tracked");
    require_true(v.gate == 1.0f, "gate raised on note_on");
    {{moduleId}}_process_float(&v, NULL, NULL, out_l, out_r, FRAMES);
    double r1 = rms(out_l, FRAMES);
    require_true(r1 > 0.01, "signal present while gate is open");

    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output finite");
        require_true(out_l[i] <= 1.0f && out_l[i] >= -1.0f, "left output bounded");
        require_true(out_r[i] <= 1.0f && out_r[i] >= -1.0f, "right output bounded");
    }

    {{moduleId}}_note_off(&v, 60);
    require_true(v.gate == 0.0f, "gate dropped on matching note_off");
    {{moduleId}}_all_notes_off(&v);
    require_true(v.gate == 0.0f, "all_notes_off drops gate");

    {{moduleId}}_destroy(&v);
    printf("{{moduleId}} core tests passed\n");
    return 0;
}

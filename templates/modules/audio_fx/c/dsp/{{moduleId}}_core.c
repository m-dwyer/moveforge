#include "{{moduleId}}_core.h"
#include <math.h>
#include <string.h>

#include "{{moduleId}}_params.gen.inc"

void {{moduleId}}_init({{moduleId}}_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    {{moduleId}}_apply_defaults(s);
}

void {{moduleId}}_process_float({{moduleId}}_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames) {
    if (!s || !in_left || !in_right || !out_left || !out_right) return;

    float drive_gain = 1.0f + s->drive * 12.0f;
    float lp_coeff = 0.02f + s->tone * 0.35f;

    for (int i = 0; i < frames; i++) {
        float wet_l = tanhf(in_left[i] * drive_gain);
        float wet_r = tanhf(in_right[i] * drive_gain);
        s->lp_l += (wet_l - s->lp_l) * lp_coeff;
        s->lp_r += (wet_r - s->lp_r) * lp_coeff;

        out_left[i] = in_left[i] * (1.0f - s->mix) + s->lp_l * s->mix;
        out_right[i] = in_right[i] * (1.0f - s->mix) + s->lp_r * s->mix;
    }
}

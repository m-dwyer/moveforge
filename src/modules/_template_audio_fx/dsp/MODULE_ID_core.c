#include "MODULE_ID_core.h"
#include <math.h>
#include <string.h>

static float clampf_local(float x, float lo, float hi) {
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
}

void MODULE_ID_init(MODULE_ID_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    s->mix = 0.5f;
    s->drive = 0.2f;
    s->tone = 0.7f;
}

int MODULE_ID_param_id(const char *key) {
    if (!key) return -1;
    if (strcmp(key, "mix") == 0) return MODULE_UPPER_PARAM_MIX;
    if (strcmp(key, "drive") == 0) return MODULE_UPPER_PARAM_DRIVE;
    if (strcmp(key, "tone") == 0) return MODULE_UPPER_PARAM_TONE;
    return -1;
}

void MODULE_ID_set_param(MODULE_ID_core_t *s, int param_id, float value) {
    if (!s) return;
    switch (param_id) {
        case MODULE_UPPER_PARAM_MIX:   s->mix   = clampf_local(value, 0.0f, 1.0f); break;
        case MODULE_UPPER_PARAM_DRIVE: s->drive = clampf_local(value, 0.0f, 1.0f); break;
        case MODULE_UPPER_PARAM_TONE:  s->tone  = clampf_local(value, 0.0f, 1.0f); break;
        default: break;
    }
}

float MODULE_ID_get_param(const MODULE_ID_core_t *s, int param_id) {
    if (!s) return 0.0f;
    switch (param_id) {
        case MODULE_UPPER_PARAM_MIX: return s->mix;
        case MODULE_UPPER_PARAM_DRIVE: return s->drive;
        case MODULE_UPPER_PARAM_TONE: return s->tone;
        default: return 0.0f;
    }
}

void MODULE_ID_process_float(MODULE_ID_core_t *s,
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

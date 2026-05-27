#include "trail_core.h"
#include <string.h>

#include "trail_params.gen.inc"

/* Time knob maps 0..1 -> ~5ms..~1000ms at 44.1 kHz. */
#define TRAIL_DELAY_MIN 220
#define TRAIL_DELAY_RANGE (TRAIL_DELAY_MAX - TRAIL_DELAY_MIN)

void trail_init(trail_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    trail_apply_defaults(s);
}

static inline float soft_clip(float x) {
    if (x > 1.5f) x = 1.5f;
    if (x < -1.5f) x = -1.5f;
    return x;
}

void trail_process_float(trail_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames) {
    if (!s || !in_left || !in_right || !out_left || !out_right) return;

    int delay = TRAIL_DELAY_MIN + (int)(s->time * (float)TRAIL_DELAY_RANGE);
    if (delay < 1) delay = 1;
    if (delay >= TRAIL_DELAY_MAX) delay = TRAIL_DELAY_MAX - 1;

    float fb = s->feedback;
    if (fb < 0.0f) fb = 0.0f;
    if (fb > 0.95f) fb = 0.95f;

    float mix = s->mix;
    if (mix < 0.0f) mix = 0.0f;
    if (mix > 1.0f) mix = 1.0f;

    const float damp = 0.3f;
    int w = s->write_idx;

    for (int i = 0; i < frames; i++) {
        int r = w - delay;
        if (r < 0) r += TRAIL_DELAY_MAX;

        float dl = s->buf_l[r];
        float dr = s->buf_r[r];

        s->lpf_l += (dl - s->lpf_l) * damp;
        s->lpf_r += (dr - s->lpf_r) * damp;

        s->buf_l[w] = soft_clip(in_left[i]  + s->lpf_l * fb);
        s->buf_r[w] = soft_clip(in_right[i] + s->lpf_r * fb);

        out_left[i]  = in_left[i]  * (1.0f - mix) + dl * mix;
        out_right[i] = in_right[i] * (1.0f - mix) + dr * mix;

        w++;
        if (w >= TRAIL_DELAY_MAX) w = 0;
    }

    s->write_idx = w;
}

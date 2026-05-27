#ifndef TRAIL_CORE_H
#define TRAIL_CORE_H

/* Max delay length per channel: 48000 samples ~= 1.088s at 44.1 kHz. */
#define TRAIL_DELAY_MAX 48000

typedef struct {
    float time;
    float feedback;
    float mix;
    float buf_l[TRAIL_DELAY_MAX];
    float buf_r[TRAIL_DELAY_MAX];
    float lpf_l;
    float lpf_r;
    int write_idx;
} trail_core_t;

void trail_init(trail_core_t *s);
void trail_apply_defaults(trail_core_t *s);
int trail_param_id(const char *key);
void trail_set_param(trail_core_t *s, int param_id, float value);
float trail_get_param(const trail_core_t *s, int param_id);
void trail_process_float(trail_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif

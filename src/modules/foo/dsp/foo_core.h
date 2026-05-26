#ifndef FOO_CORE_H
#define FOO_CORE_H

/* Max delay length per channel: 48000 samples ~= 1.088s at 44.1 kHz. */
#define FOO_DELAY_MAX 48000

typedef struct {
    float time;
    float feedback;
    float mix;
    float buf_l[FOO_DELAY_MAX];
    float buf_r[FOO_DELAY_MAX];
    float lpf_l;
    float lpf_r;
    int write_idx;
} foo_core_t;

void foo_init(foo_core_t *s);
void foo_apply_defaults(foo_core_t *s);
int foo_param_id(const char *key);
void foo_set_param(foo_core_t *s, int param_id, float value);
float foo_get_param(const foo_core_t *s, int param_id);
void foo_process_float(foo_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif

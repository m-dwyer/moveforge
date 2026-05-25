#ifndef FOO_CORE_H
#define FOO_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

enum {
    FOO_PARAM_VOLUME = 0,
    FOO_PARAM_TONE = 1
};

typedef struct {
    float phase;
    float freq;
    float target_freq;
    float velocity;
    float env;
    float gate;
    int active_note;
    float pitch_bend;

    float volume;
    float tone;
} foo_core_t;

void foo_init(foo_core_t *s);
void foo_set_param(foo_core_t *s, int param_id, float value);
float foo_get_param(const foo_core_t *s, int param_id);
int foo_param_id(const char *key);
void foo_note_on(foo_core_t *s, int note, float velocity);
void foo_note_off(foo_core_t *s, int note);
void foo_all_notes_off(foo_core_t *s);
void foo_pitch_bend(foo_core_t *s, float bend);
void foo_process_float(foo_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#ifdef __cplusplus
}
#endif

#endif

#ifndef {{moduleUpper}}_CORE_H
#define {{moduleUpper}}_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

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
} {{moduleId}}_core_t;

void {{moduleId}}_init({{moduleId}}_core_t *s);
void {{moduleId}}_apply_defaults({{moduleId}}_core_t *s);
void {{moduleId}}_set_param({{moduleId}}_core_t *s, int param_id, float value);
float {{moduleId}}_get_param(const {{moduleId}}_core_t *s, int param_id);
int {{moduleId}}_param_id(const char *key);
void {{moduleId}}_note_on({{moduleId}}_core_t *s, int note, float velocity);
void {{moduleId}}_note_off({{moduleId}}_core_t *s, int note);
void {{moduleId}}_all_notes_off({{moduleId}}_core_t *s);
void {{moduleId}}_pitch_bend({{moduleId}}_core_t *s, float bend);
void {{moduleId}}_process_float({{moduleId}}_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#ifdef __cplusplus
}
#endif

#endif

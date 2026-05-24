#ifndef MODULE_UPPER_CORE_H
#define MODULE_UPPER_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

enum {
    MODULE_UPPER_PARAM_VOLUME = 0,
    MODULE_UPPER_PARAM_TONE = 1
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
} MODULE_ID_core_t;

void MODULE_ID_init(MODULE_ID_core_t *s);
void MODULE_ID_set_param(MODULE_ID_core_t *s, int param_id, float value);
float MODULE_ID_get_param(const MODULE_ID_core_t *s, int param_id);
int MODULE_ID_param_id(const char *key);
void MODULE_ID_note_on(MODULE_ID_core_t *s, int note, float velocity);
void MODULE_ID_note_off(MODULE_ID_core_t *s, int note);
void MODULE_ID_all_notes_off(MODULE_ID_core_t *s);
void MODULE_ID_pitch_bend(MODULE_ID_core_t *s, float bend);
void MODULE_ID_process_float(MODULE_ID_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#ifdef __cplusplus
}
#endif

#endif

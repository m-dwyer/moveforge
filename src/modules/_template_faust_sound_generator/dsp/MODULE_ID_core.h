#ifndef MODULE_UPPER_CORE_H
#define MODULE_UPPER_CORE_H

typedef struct {
    float level;

    int active_note;
    float current_freq;
    float current_gain;
    float gate;
    float pitch_bend_semis;

    void *fdsp;
    void *zones[1];
    void *zone_gate;
    void *zone_freq;
    void *zone_gain;
} MODULE_ID_core_t;

void MODULE_ID_init(MODULE_ID_core_t *s);
void MODULE_ID_destroy(MODULE_ID_core_t *s);
void MODULE_ID_apply_defaults(MODULE_ID_core_t *s);
int MODULE_ID_param_id(const char *key);
void MODULE_ID_set_param(MODULE_ID_core_t *s, int param_id, float value);
float MODULE_ID_get_param(const MODULE_ID_core_t *s, int param_id);
void MODULE_ID_note_on(MODULE_ID_core_t *s, int note, float velocity);
void MODULE_ID_note_off(MODULE_ID_core_t *s, int note);
void MODULE_ID_all_notes_off(MODULE_ID_core_t *s);
void MODULE_ID_pitch_bend(MODULE_ID_core_t *s, float bend_normalized);
void MODULE_ID_process_float(MODULE_ID_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif

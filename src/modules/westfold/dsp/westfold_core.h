#ifndef WESTFOLD_CORE_H
#define WESTFOLD_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    float phase_a;
    float phase_b;
    float freq;
    float target_freq;
    float velocity;
    float env;
    float strike_env;
    float gate;
    float lp;
    float hp_x;
    float hp_y;
    float chaos_phase;
    float note_rand;
    int active_note;
    float pitch_bend;

    float volume;
    float ratio;
    float fm;
    float fold;
    float lpg;
    float drive;
    float strike;
    float chaos;
    float sustain;
    float decay;
    float release;
    float bend_range;
} westfold_core_t;

void westfold_init(westfold_core_t *s);
void westfold_apply_defaults(westfold_core_t *s);
void westfold_set_param(westfold_core_t *s, int param_id, float value);
float westfold_get_param(const westfold_core_t *s, int param_id);
int westfold_param_id(const char *key);
void westfold_note_on(westfold_core_t *s, int note, float velocity);
void westfold_note_off(westfold_core_t *s, int note);
void westfold_all_notes_off(westfold_core_t *s);
void westfold_pitch_bend(westfold_core_t *s, float bend);
void westfold_process_float(westfold_core_t *s,
                            const float *in_left, const float *in_right,
                            float *out_left, float *out_right,
                            int frames);

#ifdef __cplusplus
}
#endif

#endif

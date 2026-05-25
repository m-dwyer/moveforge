#ifndef DUSTLINE_CORE_H
#define DUSTLINE_CORE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    float phase;
    float sub_phase;
    float freq;
    float target_freq;
    float velocity;
    float env;
    float gate;
    float lp;
    float bp;
    float rng;
    int active_note;
    float pitch_bend;

    float volume;
    float wave;
    float noise;
    float cutoff;
    float resonance;
    float attack;
    float release;
    float drive;
    float bend_range;
} dustline_core_t;

void dustline_init(dustline_core_t *s);
void dustline_apply_defaults(dustline_core_t *s);
void dustline_set_param(dustline_core_t *s, int param_id, float value);
float dustline_get_param(const dustline_core_t *s, int param_id);
int dustline_param_id(const char *key);
void dustline_note_on(dustline_core_t *s, int note, float velocity);
void dustline_note_off(dustline_core_t *s, int note);
void dustline_all_notes_off(dustline_core_t *s);
void dustline_pitch_bend(dustline_core_t *s, float bend);
void dustline_process_float(dustline_core_t *s,
                            const float *in_left, const float *in_right,
                            float *out_left, float *out_right,
                            int frames);

#ifdef __cplusplus
}
#endif

#endif

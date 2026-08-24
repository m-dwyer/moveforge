#ifndef VCA_CORE_H
#define VCA_CORE_H

#include <stdint.h>

/* Which part of the envelope owns the gain right now. */
enum {
    VCA_STAGE_IDLE = 0,
    VCA_STAGE_ATTACK,
    VCA_STAGE_DECAY,
    VCA_STAGE_RELEASE
};

typedef struct {
    /* one float per module.json key (gen-params writes these) */
    float attack;
    float decay;
    float sustain;
    float release;

    /* Which notes are down, one bit per MIDI note. A count would drift on an
     * unmatched note-off and leave the gate stuck open; a bitmask cannot. */
    uint32_t held[4];

    /* Until the first note arrives the gain is 1, so loading a VCA over a
     * sounding chain is inaudible rather than a cut. `arming` marks the render
     * that takes the gain, and `passthrough_peak` is what the chain was doing
     * when it did, so the handover can be continuous. */
    int armed;
    int arming;
    float passthrough_peak;
    int stage;
    float value;

    float attack_coeff;
    float decay_coeff;
    float release_coeff;
    float coeff_attack_seconds;
    float coeff_decay_seconds;
    float coeff_release_seconds;
} vca_core_t;

void vca_init(vca_core_t *s);
void vca_apply_defaults(vca_core_t *s);
int vca_param_id(const char *key);
void vca_set_param(vca_core_t *s, int param_id, float value);
float vca_get_param(const vca_core_t *s, int param_id);

/* A note opens and closes the gate. Anything that is not a note is ignored. */
void vca_handle_midi(vca_core_t *s, int status, int d1, int d2);

/* Releases every held note, so a panic cannot leave the gate open. */
void vca_all_notes_off(vca_core_t *s);

void vca_process_float(vca_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif

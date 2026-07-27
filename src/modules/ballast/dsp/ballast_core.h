#ifndef BALLAST_CORE_H
#define BALLAST_CORE_H

#include "modules/_shared/mf_dsp.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Ballast — one low-end voice covering kick, tom and sub-bass.
 *
 * They are the same synthesis: a pitched sine/triangle body under a falling
 * pitch envelope, a transient on top, and saturation. `track` moves along that
 * axis — fixed pitch is a kick, note-tracked with a short decay is a tom,
 * note-tracked with a long decay is an 808 sub.
 *
 * One-shot: note-off is ignored, and `decay` alone decides how long a hit
 * lasts. That is why there is no mf_voice_t here. The held-note stack exists to
 * stop a *sustaining* voice dropping a still-held note on an unrelated
 * note-off; a percussion voice has no sustain for that bug to occur in, and
 * tracking a stack would let a note-off repitch a hit that is already
 * decaying. The pitch is latched at note-on instead. `all_notes_off` still
 * silences, for CC 123. */

typedef struct {
    /* note state, latched at trigger */
    float note_semis;
    float velocity;
    float pitch_bend;
    int   sounding;

    /* oscillator */
    float osc_phase;

    /* Retrigger declick. A trigger resets the oscillator phase, which is a
     * step discontinuity in the output. `declick` is seeded with exactly that
     * step and decays over ~0.7 ms, so the output is continuous by
     * construction. Inaudible in kick mode, where the new transient masks it,
     * and the difference between usable and unusable for legato sub lines. */
    float declick;
    float last_out;
    int   retrigger;

    /* Amp envelope. Exponential and linear run in parallel and are crossfaded
     * by `shape`; two adds per sample against a powf, and exact at both ends. */
    float amp_exp;
    float amp_lin;

    float pitch_fast;
    float pitch_slow;
    float click_env;
    float dirt_env;

    /* resolved once per hit from `human` */
    float hit_detune;
    float hit_decay;
    float hit_drive;
    float hit_level;

    mf_rng_t rng;
    mf_onepole_t click_lp;
    mf_svf_t dirt_bp;
    mf_tilt_t tilt;
    mf_dcblock_t dc;
    mf_drive_t drive_state;
    mf_smooth_t volume_sm;

    /* params — one float per module.json key, in declaration order */
    float tune;
    float punch;
    float drop;
    float decay;
    float drive;
    float tone;
    float dirt;
    float volume;
    float track;
    float sweep;
    float shape;
    float phase;
    float curve;
    float body;
    float vel_depth;
    float human;
} ballast_core_t;

void ballast_init(ballast_core_t *s);
void ballast_apply_defaults(ballast_core_t *s);
void ballast_set_param(ballast_core_t *s, int param_id, float value);
float ballast_get_param(const ballast_core_t *s, int param_id);
int ballast_param_id(const char *key);
void ballast_note_on(ballast_core_t *s, int note, float velocity);
void ballast_note_off(ballast_core_t *s, int note);
void ballast_all_notes_off(ballast_core_t *s);
void ballast_pitch_bend(ballast_core_t *s, float bend);
void ballast_process_float(ballast_core_t *s,
                           const float *in_left, const float *in_right,
                           float *out_left, float *out_right,
                           int frames);

#ifdef __cplusplus
}
#endif

#endif

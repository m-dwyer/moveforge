#ifndef SWARF_CORE_H
#define SWARF_CORE_H

/* Swarf — six note-mapped percussion voices sharing one engine.
 *
 * There is no per-voice algorithm, no material selector and no mode switch. Every
 * voice runs the identical topology; the defaults and the level label give it its
 * role. Turn voice 1's `mat` down and its `decay` up and it is a conga, and the
 * label still says Hat.
 *
 *   note on
 *      |- trigger micro-offset (0-3 ms, deterministic per voice, scaled by `human`)
 *      v
 *   EXCITATION   mf_exciter_t: grains, density and burst structure on one axis
 *      |--------------------------------+  (1 - body)
 *      v                                |
 *   PARTIALS   mat < 0.25: tuned comb    |
 *              mat >= 0.25: 10 x mf_reson_t at f0 * ratio_k(mat), T60_k, gain_k
 *              crossfaded across 0.20-0.30
 *      |  (body)                        v
 *      +---------------- mix -----------+
 *      v
 *   AMP ENV    mf_decay_t, exp/linear crossfade by the kit's `shape`
 *   FILTER     one SVF, `tone` as a monotone brightness sweep
 *   DRIVE      `grit` into the kit's `curve`, normalised by this voice's envelope
 *   LEVEL/PAN  equal-power pan from voice index x `spread`
 *      v
 *   accumulate into the stereo bus
 *
 * Impulse-excited a resonator is a decaying sinusoid; noise-excited it is a noise
 * band. Same coefficients either way — which is why this engine has no oscillators
 * at all, and why "struck membrane" and "sustained metal cluster" are one code path.
 *
 * ### The struct is flat on purpose
 *
 * scripts/validate-params.ts requires a literal `float <key>;` here for every
 * declared parameter; it cannot see through `struct voice { float tune; } v[6]`. So
 * parameter *storage* is 62 flat fields named exactly as their keys, and a pointer
 * table built once in swarf_init gathers each voice's eight. Voice *state* lives in
 * a proper swarf_voice_t[6].
 */

#include <stdint.h>

#include "modules/_shared/mf_dsp.h"
#include "swarf_params.gen.h"

#ifdef __cplusplus
extern "C" {
#endif

#define SWARF_VOICES 6
#define SWARF_VOICE_PARAMS 8

/* Sized 10 and skipped aggressively. The anchor ratio tables are the expensive
 * thing to get right and cost nothing to write once; extending them later would
 * mean re-deriving four sets of ratios and re-measuring CPU. */
#define SWARF_PARTIALS 10

/* 46 ms at 44.1 kHz, so the comb reaches 21.5 Hz — below the 32.7 Hz that the
 * bottom of the `tune` range asks for. */
#define SWARF_COMB_LEN 2048

typedef struct {
    /* --- excitation and envelope --- */
    mf_exciter_t exciter;
    mf_exciter_coeffs_t exciter_co;
    mf_decay_t amp;
    mf_decay_coeffs_t amp_co;

    /* --- partial bank --- */
    mf_reson_t partial[SWARF_PARTIALS];
    mf_reson_coeffs_t partial_co[SWARF_PARTIALS];
    float partial_gain[SWARF_PARTIALS];
    int live[SWARF_PARTIALS];   /* indices that survived skipping */
    int live_count;

    /* --- tuned comb, used at the bottom of the `mat` axis --- */
    float comb[SWARF_COMB_LEN];
    int comb_write;
    float comb_delay;      /* in samples, fractional */
    float comb_fb;
    float comb_damp;       /* one-pole state inside the feedback path */
    float comb_ap;         /* allpass fractional-delay state */
    float comb_ap_c;
    float comb_damp_a;
    float comb_mix;        /* 1 = all comb, 0 = all bank */

    /* --- per-voice stages --- */
    mf_svf_t tone_filt;
    mf_svf_coeffs_t tone_co;
    int tone_is_highpass;
    mf_drive_t drive;
    mf_drive_coeffs_t drive_co;
    mf_rng_t rng;

    /* --- per-hit state --- */
    float velocity;
    float hit_tune;        /* multiplier on f0   */
    float hit_decay;       /* multiplier on T60  */
    float hit_drive;
    float hit_level;
    float pan_l, pan_r;
    float exc_gain;        /* (1 - body), with velocity applied */
    float bank_gain;       /* body */
    float out_gain;

    /* Choke is an ~8 ms release ramp, not a cut: continuous by construction, so it
     * needs no declick of its own. */
    float choke_gain;
    float choke_step;

    /* MIDI is block-quantised, so two voices on one step are sample-exactly
     * simultaneous. A deterministic per-voice offset turns that into expression. */
    int pending;
    int pending_delay;
    float pending_velocity;

    int dirty;             /* coefficients need recomputing */
} swarf_voice_t;

typedef struct {
    swarf_voice_t voice[SWARF_VOICES];

    /* --- bus --- */
    mf_tilt_t tilt_l, tilt_r;
    mf_drive_t bus_drive_l, bus_drive_r;
    mf_drive_coeffs_t bus_drive_co;
    mf_dcblock_t dc_l, dc_r;
    /* Auto gain compensation for the bus drive, measured one block behind. */
    float bus_comp;
    mf_smooth_t volume_sm;
    /* One bus declick, not six: every retrigger lands on sample 0 of a block, so a
     * single bus-level ramp captures the total discontinuity whichever voice caused
     * it. Downstream of the gain that steps, and never seeded from silence. */
    float declick_l, declick_r;
    float declick_coeff;
    float last_l, last_r;
    int sounded;

    float pitch_bend;

    /* --- parameter storage ---
     * One `float <key>;` per line, not comma-separated: validate-params.ts matches
     * the declaration literally, and it is right to — a field it cannot see is a
     * parameter the host offers and the module does not answer to. */
    /* 1 Hat */
    float hat_tune;
    float hat_decay;
    float hat_mat;
    float hat_body;
    float hat_tone;
    float hat_strike;
    float hat_grit;
    float hat_level;

    /* 2 OpenHat */
    float oh_tune;
    float oh_decay;
    float oh_mat;
    float oh_body;
    float oh_tone;
    float oh_strike;
    float oh_grit;
    float oh_level;

    /* 3 Ride */
    float ride_tune;
    float ride_decay;
    float ride_mat;
    float ride_body;
    float ride_tone;
    float ride_strike;
    float ride_grit;
    float ride_level;

    /* 4 Clap */
    float clap_tune;
    float clap_decay;
    float clap_mat;
    float clap_body;
    float clap_tone;
    float clap_strike;
    float clap_grit;
    float clap_level;

    /* 5 Conga */
    float conga_tune;
    float conga_decay;
    float conga_mat;
    float conga_body;
    float conga_tone;
    float conga_strike;
    float conga_grit;
    float conga_level;

    /* 6 Wood */
    float wood_tune;
    float wood_decay;
    float wood_mat;
    float wood_body;
    float wood_tone;
    float wood_strike;
    float wood_grit;
    float wood_level;

    /* Kit */
    float volume;
    float drive;
    float curve;
    float tone;
    float shape;
    float human;
    float vel_depth;
    float spread;

    /* Map */
    float root;
    float chrom;
    float choke;
    float kit_decay;
    float bright;
    float warp;

    /* Gathers each voice's eight parameters out of the flat fields above. Built
     * once in swarf_init; the order matches the SWARF_VP_* enum below. */
    float *vp[SWARF_VOICES][SWARF_VOICE_PARAMS];
} swarf_core_t;

/* Index into swarf_core_t.vp[voice][...]. Declaration order of a voice's level. */
enum {
    SWARF_VP_TUNE = 0,
    SWARF_VP_DECAY,
    SWARF_VP_MAT,
    SWARF_VP_BODY,
    SWARF_VP_TONE,
    SWARF_VP_STRIKE,
    SWARF_VP_GRIT,
    SWARF_VP_LEVEL
};

void swarf_init(swarf_core_t *s);
void swarf_apply_defaults(swarf_core_t *s);
void swarf_set_param(swarf_core_t *s, int param_id, float value);
float swarf_get_param(const swarf_core_t *s, int param_id);
int swarf_param_id(const char *key);
void swarf_note_on(swarf_core_t *s, int note, float velocity);
void swarf_note_off(swarf_core_t *s, int note);
void swarf_all_notes_off(swarf_core_t *s);
void swarf_pitch_bend(swarf_core_t *s, float bend);
void swarf_process_float(swarf_core_t *s,
                         const float *in_left, const float *in_right,
                         float *out_left, float *out_right,
                         int frames);

/* Exposed for tests and measurement probes. */
float swarf_decay_seconds(float position);
int swarf_voice_for_note(const swarf_core_t *s, int note, float *out_ratio);
int swarf_voice_is_idle(const swarf_core_t *s, int voice);
int swarf_is_idle(const swarf_core_t *s);

#ifdef __cplusplus
}
#endif

#endif

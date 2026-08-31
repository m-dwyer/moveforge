#ifndef FILTER_CORE_H
#define FILTER_CORE_H

/* FILTER_PARAM_COUNT and the FILTER_PARAM_* enum, generated
 * from module.json by gen-params. zones[] must be sized from that count, never
 * a literal: a hand-written size silently overflows into the next field the
 * first time you add a param, and no sanitizer can see it (it is an
 * intra-struct write). */
#include "filter_params.gen.h"
#include "modules/_shared/mf_dsp.h"

typedef struct {
    /* one float per module.json key (gen-params writes these) */
    float cutoff;
    float resonance;
    float morph;
    float filter_attack;
    float filter_decay;
    float filter_sustain;
    float filter_release;
    float env_amount;

    /* The envelope runs here rather than in the DSP. Faust hoists a
     * slider-only frequency out of the sample loop; a frequency that moves
     * every sample would drag tan() back into it. Sweeping at control rate
     * keeps that hoist and costs one tan per sub-block. */
    mf_adsr_t env;

    void *fdsp;
    void *zones[FILTER_PARAM_COUNT];
} filter_core_t;

void filter_init(filter_core_t *s);
void filter_destroy(filter_core_t *s);
void filter_apply_defaults(filter_core_t *s);
int filter_param_id(const char *key);
void filter_set_param(filter_core_t *s, int param_id, float value);
float filter_get_param(const filter_core_t *s, int param_id);
/* A note opens and closes the envelope. Anything that is not a note is ignored. */
void filter_handle_midi(filter_core_t *s, int status, int d1, int d2);

/* Releases every held note, so a panic cannot leave the envelope open. */
void filter_all_notes_off(filter_core_t *s);

void filter_process_float(filter_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif

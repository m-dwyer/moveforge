#ifndef FILTER_CORE_H
#define FILTER_CORE_H

/* FILTER_PARAM_COUNT and the FILTER_PARAM_* enum, generated
 * from module.json by gen-params. zones[] must be sized from that count, never
 * a literal: a hand-written size silently overflows into the next field the
 * first time you add a param, and no sanitizer can see it (it is an
 * intra-struct write). */
#include "filter_params.gen.h"

typedef struct {
    float cutoff;
    float resonance;
    float morph;

    void *fdsp;
    void *zones[FILTER_PARAM_COUNT];
} filter_core_t;

void filter_init(filter_core_t *s);
void filter_destroy(filter_core_t *s);
void filter_apply_defaults(filter_core_t *s);
int filter_param_id(const char *key);
void filter_set_param(filter_core_t *s, int param_id, float value);
float filter_get_param(const filter_core_t *s, int param_id);
void filter_process_float(filter_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif

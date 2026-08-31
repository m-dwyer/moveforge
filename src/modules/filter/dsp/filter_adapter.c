#include "filter_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

#include <math.h>
#include <string.h>

#include "filter_faust.c"
#include "filter_params.gen.inc"

static void capture_slider(void *ui, const char *label, FAUSTFLOAT *zone,
                           FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {
    (void)init; (void)min; (void)max; (void)step;
    filter_core_t *core = (filter_core_t*)ui;
    int id = filter_param_id(label);
    if (id >= 0 && id < FILTER_PARAM_COUNT) core->zones[id] = (void*)zone;
}

/* The envelope params have no slider: they are read here and reach the DSP
 * only through the swept cutoff. A NULL zone is therefore expected for them,
 * and the ones Faust does own are asserted by name in the core test. */
static void push_params_to_faust(filter_core_t *s) {
    for (int i = 0; i < FILTER_PARAM_COUNT; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)filter_get_param(s, i);
    }
}

/* How many frames the swept cutoff holds still for.
 *
 * The coefficient work is one tan for the whole sub-block, so 32 frames is
 * about 0.7 ms of envelope resolution for 1/32nd of the cost of sweeping every
 * sample. Short enough that a fast attack is heard as a sweep rather than as a
 * step, cheap enough that the hoist Faust does is still worth having. */
#define FILTER_SWEEP_FRAMES 32

/* The cutoff the envelope has moved this sub-block to.
 *
 * The amount is in octaves, so the envelope multiplies the frequency rather
 * than adding to it: the same setting sweeps the same musical distance
 * wherever the cutoff is parked. */
static float swept_cutoff(const filter_core_t *s, float env) {
    float octaves = s->env_amount * env;
    float swept = s->cutoff * powf(2.0f, octaves);
    return moveforge_clampf(swept, 20.0f, 18000.0f);
}

void filter_handle_midi(filter_core_t *s, int status, int d1, int d2) {
    if (!s) return;
    mf_adsr_handle_midi(&s->env, status, d1, d2);
}

void filter_all_notes_off(filter_core_t *s) {
    if (!s) return;
    mf_adsr_all_notes_off(&s->env);
}

void filter_init(filter_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    filter_apply_defaults(s);
    mf_adsr_init(&s->env);

    s->fdsp = newfilter_faust();
    if (!s->fdsp) return;
    initfilter_faust((filter_faust*)s->fdsp, (int)MOVEFORGE_SAMPLE_RATE);

    UIGlue glue = moveforge_faust_make_ui(s, capture_slider);
    buildUserInterfacefilter_faust((filter_faust*)s->fdsp, &glue);

    push_params_to_faust(s);
}

void filter_destroy(filter_core_t *s) {
    if (!s) return;
    if (s->fdsp) {
        deletefilter_faust((filter_faust*)s->fdsp);
        s->fdsp = NULL;
    }
}

void filter_process_float(filter_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames) {
    if (!s || !s->fdsp || !in_left || !in_right || !out_left || !out_right) return;
    push_params_to_faust(s);
    mf_adsr_set_times(&s->env, s->filter_attack, s->filter_decay,
                      s->filter_release);

    FAUSTFLOAT *cutoff_zone = (FAUSTFLOAT*)s->zones[FILTER_PARAM_CUTOFF];

    for (int offset = 0; offset < frames; offset += FILTER_SWEEP_FRAMES) {
        int count = frames - offset;
        if (count > FILTER_SWEEP_FRAMES) count = FILTER_SWEEP_FRAMES;

        /* The envelope advances every sample so its times stay true; only the
         * frequency it drives holds still, for as long as one sub-block. */
        float env = 0.0f;
        for (int i = 0; i < count; i++) env = mf_adsr_tick(&s->env, s->filter_sustain);
        if (cutoff_zone) *cutoff_zone = (FAUSTFLOAT)swept_cutoff(s, env);

        FAUSTFLOAT *inputs[2] = {
            (FAUSTFLOAT*)(in_left + offset), (FAUSTFLOAT*)(in_right + offset)
        };
        FAUSTFLOAT *outputs[2] = { out_left + offset, out_right + offset };
        computefilter_faust((filter_faust*)s->fdsp, count, inputs, outputs);
    }
}

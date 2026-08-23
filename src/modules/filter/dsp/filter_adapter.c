#include "filter_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

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

static void push_params_to_faust(filter_core_t *s) {
    for (int i = 0; i < FILTER_PARAM_COUNT; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)filter_get_param(s, i);
    }
}

void filter_init(filter_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    filter_apply_defaults(s);

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

    FAUSTFLOAT *inputs[2] = { (FAUSTFLOAT*)in_left, (FAUSTFLOAT*)in_right };
    FAUSTFLOAT *outputs[2] = { out_left, out_right };
    computefilter_faust((filter_faust*)s->fdsp, frames, inputs, outputs);
}

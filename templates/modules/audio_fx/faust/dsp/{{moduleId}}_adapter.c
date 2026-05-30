#include "{{moduleId}}_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

#include <string.h>

#include "{{moduleId}}_faust.c"
#include "{{moduleId}}_params.gen.inc"

static void capture_slider(void *ui, const char *label, FAUSTFLOAT *zone,
                           FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {
    (void)init; (void)min; (void)max; (void)step;
    {{moduleId}}_core_t *core = ({{moduleId}}_core_t*)ui;
    int id = {{moduleId}}_param_id(label);
    if (id >= 0 && id < 2) core->zones[id] = (void*)zone;
}

static void push_params_to_faust({{moduleId}}_core_t *s) {
    float vals[2] = { s->mix, s->level };
    for (int i = 0; i < 2; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)vals[i];
    }
}

void {{moduleId}}_init({{moduleId}}_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    {{moduleId}}_apply_defaults(s);

    s->fdsp = new{{moduleId}}_faust();
    if (!s->fdsp) return;
    init{{moduleId}}_faust(({{moduleId}}_faust*)s->fdsp, (int)MOVEFORGE_SAMPLE_RATE);

    UIGlue glue = moveforge_faust_make_ui(s, capture_slider);
    buildUserInterface{{moduleId}}_faust(({{moduleId}}_faust*)s->fdsp, &glue);

    push_params_to_faust(s);
}

void {{moduleId}}_destroy({{moduleId}}_core_t *s) {
    if (!s) return;
    if (s->fdsp) {
        delete{{moduleId}}_faust(({{moduleId}}_faust*)s->fdsp);
        s->fdsp = NULL;
    }
}

void {{moduleId}}_process_float({{moduleId}}_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames) {
    if (!s || !s->fdsp || !in_left || !in_right || !out_left || !out_right) return;
    push_params_to_faust(s);

    FAUSTFLOAT *inputs[2] = { (FAUSTFLOAT*)in_left, (FAUSTFLOAT*)in_right };
    FAUSTFLOAT *outputs[2] = { out_left, out_right };
    compute{{moduleId}}_faust(({{moduleId}}_faust*)s->fdsp, frames, inputs, outputs);
}

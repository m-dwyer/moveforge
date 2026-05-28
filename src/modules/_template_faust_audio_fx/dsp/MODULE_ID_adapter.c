#include "MODULE_ID_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

#include <string.h>

#include "MODULE_ID_faust.c"
#include "MODULE_ID_params.gen.inc"

static void capture_slider(void *ui, const char *label, FAUSTFLOAT *zone,
                           FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {
    (void)init; (void)min; (void)max; (void)step;
    MODULE_ID_core_t *core = (MODULE_ID_core_t*)ui;
    int id = MODULE_ID_param_id(label);
    if (id >= 0 && id < 2) core->zones[id] = (void*)zone;
}

static void push_params_to_faust(MODULE_ID_core_t *s) {
    float vals[2] = { s->mix, s->level };
    for (int i = 0; i < 2; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)vals[i];
    }
}

void MODULE_ID_init(MODULE_ID_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    MODULE_ID_apply_defaults(s);

    s->fdsp = newMODULE_ID_faust();
    if (!s->fdsp) return;
    initMODULE_ID_faust((MODULE_ID_faust*)s->fdsp, (int)MOVEFORGE_SAMPLE_RATE);

    UIGlue glue = moveforge_faust_make_ui(s, capture_slider);
    buildUserInterfaceMODULE_ID_faust((MODULE_ID_faust*)s->fdsp, &glue);

    push_params_to_faust(s);
}

void MODULE_ID_destroy(MODULE_ID_core_t *s) {
    if (!s) return;
    if (s->fdsp) {
        deleteMODULE_ID_faust((MODULE_ID_faust*)s->fdsp);
        s->fdsp = NULL;
    }
}

void MODULE_ID_process_float(MODULE_ID_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames) {
    if (!s || !s->fdsp || !in_left || !in_right || !out_left || !out_right) return;
    push_params_to_faust(s);

    FAUSTFLOAT *inputs[2] = { (FAUSTFLOAT*)in_left, (FAUSTFLOAT*)in_right };
    FAUSTFLOAT *outputs[2] = { out_left, out_right };
    computeMODULE_ID_faust((MODULE_ID_faust*)s->fdsp, frames, inputs, outputs);
}

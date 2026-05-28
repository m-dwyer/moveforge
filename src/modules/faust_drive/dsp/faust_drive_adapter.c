#include "faust_drive_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

#include <string.h>

/* Pull the generated Faust C in-line so the moveforge build pipeline sees
 * one translation unit per module. The generated file defines the
 * faust_drive_faust struct and `new`, `init`, `delete`, `compute`,
 * `buildUserInterface` functions. */
#include "faust_drive_faust.c"

#include "faust_drive_params.gen.inc"

static void capture_slider(void *ui, const char *label, FAUSTFLOAT *zone,
                           FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {
    (void)init; (void)min; (void)max; (void)step;
    faust_drive_core_t *core = (faust_drive_core_t*)ui;
    int id = faust_drive_param_id(label);
    if (id >= 0 && id < 4) core->zones[id] = (void*)zone;
}

static void push_params_to_faust(faust_drive_core_t *s) {
    float vals[4] = { s->drive, s->tone, s->mix, s->level };
    for (int i = 0; i < 4; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)vals[i];
    }
}

void faust_drive_init(faust_drive_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    faust_drive_apply_defaults(s);

    s->fdsp = newfaust_drive_faust();
    if (!s->fdsp) return;
    initfaust_drive_faust((faust_drive_faust*)s->fdsp, (int)MOVEFORGE_SAMPLE_RATE);

    UIGlue glue = moveforge_faust_make_ui(s, capture_slider);
    buildUserInterfacefaust_drive_faust((faust_drive_faust*)s->fdsp, &glue);

    push_params_to_faust(s);
}

void faust_drive_destroy(faust_drive_core_t *s) {
    if (!s) return;
    if (s->fdsp) {
        deletefaust_drive_faust((faust_drive_faust*)s->fdsp);
        s->fdsp = NULL;
    }
}

void faust_drive_process_float(faust_drive_core_t *s,
                               const float *in_left, const float *in_right,
                               float *out_left, float *out_right,
                               int frames) {
    if (!s || !s->fdsp || !in_left || !in_right || !out_left || !out_right) return;
    push_params_to_faust(s);

    FAUSTFLOAT *inputs[2]  = { (FAUSTFLOAT*)in_left, (FAUSTFLOAT*)in_right };
    FAUSTFLOAT *outputs[2] = { out_left, out_right };
    computefaust_drive_faust((faust_drive_faust*)s->fdsp, frames, inputs, outputs);
}

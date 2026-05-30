#include "{{moduleId}}_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

#include <string.h>

#include "{{moduleId}}_faust.c"
#include "{{moduleId}}_params.gen.inc"

#define {{moduleId}}_BEND_RANGE_SEMIS 2.0f

static void capture_slider(void *ui, const char *label, FAUSTFLOAT *zone,
                           FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {
    (void)init; (void)min; (void)max; (void)step;
    {{moduleId}}_core_t *core = ({{moduleId}}_core_t*)ui;

    if (strcmp(label, "gate") == 0) { core->zone_gate = (void*)zone; return; }
    if (strcmp(label, "freq") == 0) { core->zone_freq = (void*)zone; return; }
    if (strcmp(label, "gain") == 0) { core->zone_gain = (void*)zone; return; }

    int id = {{moduleId}}_param_id(label);
    if (id >= 0 && id < 1) core->zones[id] = (void*)zone;
}

static void push_params_to_faust({{moduleId}}_core_t *s) {
    FAUSTFLOAT *level_zone = (FAUSTFLOAT*)s->zones[0];
    if (level_zone) *level_zone = (FAUSTFLOAT)s->level;
    if (s->zone_gate) *(FAUSTFLOAT*)s->zone_gate = (FAUSTFLOAT)s->gate;
    if (s->zone_freq) *(FAUSTFLOAT*)s->zone_freq = (FAUSTFLOAT)s->current_freq;
    if (s->zone_gain) *(FAUSTFLOAT*)s->zone_gain = (FAUSTFLOAT)s->current_gain;
}

static void recompute_freq({{moduleId}}_core_t *s) {
    if (s->active_note < 0) return;
    s->current_freq = moveforge_midi_note_to_hz((float)s->active_note + s->pitch_bend_semis);
}

void {{moduleId}}_init({{moduleId}}_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    {{moduleId}}_apply_defaults(s);
    s->active_note = -1;
    s->current_freq = 220.0f;
    s->current_gain = 0.0f;

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

void {{moduleId}}_note_on({{moduleId}}_core_t *s, int note, float velocity) {
    if (!s) return;
    s->active_note = note;
    s->current_gain = velocity;
    s->gate = 1.0f;
    recompute_freq(s);
}

void {{moduleId}}_note_off({{moduleId}}_core_t *s, int note) {
    if (!s) return;
    if (s->active_note == note) {
        s->gate = 0.0f;
        s->active_note = -1;
    }
}

void {{moduleId}}_all_notes_off({{moduleId}}_core_t *s) {
    if (!s) return;
    s->gate = 0.0f;
    s->active_note = -1;
}

void {{moduleId}}_pitch_bend({{moduleId}}_core_t *s, float bend_normalized) {
    if (!s) return;
    s->pitch_bend_semis = bend_normalized * {{moduleId}}_BEND_RANGE_SEMIS;
    recompute_freq(s);
}

void {{moduleId}}_process_float({{moduleId}}_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames) {
    (void)in_left; (void)in_right;
    if (!s || !s->fdsp || !out_left || !out_right) return;
    push_params_to_faust(s);

    FAUSTFLOAT *outputs[2] = { out_left, out_right };
    compute{{moduleId}}_faust(({{moduleId}}_faust*)s->fdsp, frames, NULL, outputs);
}

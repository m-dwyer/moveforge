#include "faust_voice_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

#include <string.h>

#include "faust_voice_faust.c"

#include "faust_voice_params.gen.inc"

/* Pitch bend range: ±2 semitones (a common default). The C wrapper writes
 * pitch_bend_semis directly when 0xE0 messages arrive. */
#define FAUST_VOICE_BEND_RANGE_SEMIS 2.0f

static void capture_slider(void *ui, const char *label, FAUSTFLOAT *zone,
                           FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {
    (void)init; (void)min; (void)max; (void)step;
    faust_voice_core_t *core = (faust_voice_core_t*)ui;

    /* Control inputs driven from C, not exposed in module.json. */
    if (strcmp(label, "gate") == 0) { core->zone_gate = (void*)zone; return; }
    if (strcmp(label, "freq") == 0) { core->zone_freq = (void*)zone; return; }
    if (strcmp(label, "gain") == 0) { core->zone_gain = (void*)zone; return; }

    int id = faust_voice_param_id(label);
    if (id >= 0 && id < 5) core->zones[id] = (void*)zone;
}

static void push_params_to_faust(faust_voice_core_t *s) {
    float vals[5] = { s->cutoff, s->resonance, s->attack, s->release, s->level };
    for (int i = 0; i < 5; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)vals[i];
    }
    if (s->zone_gate) *(FAUSTFLOAT*)s->zone_gate = (FAUSTFLOAT)s->gate;
    if (s->zone_freq) *(FAUSTFLOAT*)s->zone_freq = (FAUSTFLOAT)s->current_freq;
    if (s->zone_gain) *(FAUSTFLOAT*)s->zone_gain = (FAUSTFLOAT)s->current_gain;
}

static void recompute_freq(faust_voice_core_t *s) {
    if (s->active_note < 0) return;
    s->current_freq = moveforge_midi_note_to_hz((float)s->active_note + s->pitch_bend_semis);
}

void faust_voice_init(faust_voice_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    faust_voice_apply_defaults(s);
    s->active_note = -1;
    s->current_freq = 220.0f;
    s->current_gain = 0.0f;
    s->gate = 0.0f;
    s->pitch_bend_semis = 0.0f;

    s->fdsp = newfaust_voice_faust();
    if (!s->fdsp) return;
    initfaust_voice_faust((faust_voice_faust*)s->fdsp, (int)MOVEFORGE_SAMPLE_RATE);

    UIGlue glue = moveforge_faust_make_ui(s, capture_slider);
    buildUserInterfacefaust_voice_faust((faust_voice_faust*)s->fdsp, &glue);

    push_params_to_faust(s);
}

void faust_voice_destroy(faust_voice_core_t *s) {
    if (!s) return;
    if (s->fdsp) {
        deletefaust_voice_faust((faust_voice_faust*)s->fdsp);
        s->fdsp = NULL;
    }
}

void faust_voice_note_on(faust_voice_core_t *s, int note, float velocity) {
    if (!s) return;
    s->active_note = note;
    s->current_gain = velocity;
    s->gate = 1.0f;
    recompute_freq(s);
}

void faust_voice_note_off(faust_voice_core_t *s, int note) {
    if (!s) return;
    /* Mono: only release if the held note matches. */
    if (s->active_note == note) {
        s->gate = 0.0f;
        s->active_note = -1;
    }
}

void faust_voice_all_notes_off(faust_voice_core_t *s) {
    if (!s) return;
    s->gate = 0.0f;
    s->active_note = -1;
}

void faust_voice_pitch_bend(faust_voice_core_t *s, float bend_normalized) {
    if (!s) return;
    s->pitch_bend_semis = bend_normalized * FAUST_VOICE_BEND_RANGE_SEMIS;
    recompute_freq(s);
}

void faust_voice_process_float(faust_voice_core_t *s,
                               const float *in_left, const float *in_right,
                               float *out_left, float *out_right,
                               int frames) {
    (void)in_left; (void)in_right;
    if (!s || !s->fdsp || !out_left || !out_right) return;
    push_params_to_faust(s);

    FAUSTFLOAT *outputs[2] = { out_left, out_right };
    computefaust_voice_faust((faust_voice_faust*)s->fdsp, frames, NULL, outputs);
}

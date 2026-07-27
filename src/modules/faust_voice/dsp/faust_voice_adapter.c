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
    if (id >= 0 && id < FAUST_VOICE_PARAM_COUNT) core->zones[id] = (void*)zone;
}

static void push_params_to_faust(faust_voice_core_t *s) {
    for (int i = 0; i < FAUST_VOICE_PARAM_COUNT; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)faust_voice_get_param(s, i);
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
    mf_voice_init(&s->voice);
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

/* Begin sounding a note. Shared by a fresh note-on and by the fallback when a
 * higher note is released while a lower one is still held. */
static void faust_voice_start_note(faust_voice_core_t *s, int note, float velocity) {
    s->active_note = note;
    s->current_gain = velocity;
    s->gate = 1.0f;
    recompute_freq(s);
}

void faust_voice_note_on(faust_voice_core_t *s, int note, float velocity) {
    if (!s) return;
    int next_note = 0;
    float next_velocity = 0.0f;
    if (mf_voice_note_on(&s->voice, note, velocity, &next_note, &next_velocity) == MF_VOICE_START) {
        faust_voice_start_note(s, next_note, next_velocity);
    }
}

void faust_voice_note_off(faust_voice_core_t *s, int note) {
    if (!s) return;
    int next_note = 0;
    float next_velocity = 0.0f;
    switch (mf_voice_note_off(&s->voice, note, &next_note, &next_velocity)) {
        case MF_VOICE_START:
            /* Mono with last-note priority: a lower note is still held, so fall
             * back to it rather than going silent. */
            faust_voice_start_note(s, next_note, next_velocity);
            break;
        case MF_VOICE_STOP:
            s->gate = 0.0f;
            s->active_note = -1;
            break;
        default:
            break;
    }
}

void faust_voice_all_notes_off(faust_voice_core_t *s) {
    if (!s) return;
    mf_voice_all_off(&s->voice);
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

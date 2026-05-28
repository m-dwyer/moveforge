#include "MODULE_ID_core.h"
#include <math.h>
#include <string.h>

#include "MODULE_ID_params.gen.inc"
#include "modules/_shared/dsp_runtime.h"

void MODULE_ID_init(MODULE_ID_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    s->active_note = -1;
    s->target_freq = 261.626f;
    s->freq = s->target_freq;
    MODULE_ID_apply_defaults(s);
}

void MODULE_ID_note_on(MODULE_ID_core_t *s, int note, float velocity) {
    if (!s) return;
    s->active_note = note;
    s->target_freq = moveforge_midi_note_to_hz((float)note);
    s->velocity = moveforge_clampf(velocity, 0.0f, 1.0f);
    s->gate = 1.0f;
}

void MODULE_ID_note_off(MODULE_ID_core_t *s, int note) {
    if (!s || s->active_note != note) return;
    s->gate = 0.0f;
}

void MODULE_ID_all_notes_off(MODULE_ID_core_t *s) {
    if (!s) return;
    s->gate = 0.0f;
    s->active_note = -1;
}

void MODULE_ID_pitch_bend(MODULE_ID_core_t *s, float bend) {
    if (!s) return;
    s->pitch_bend = moveforge_clampf(bend, -1.0f, 1.0f);
}

void MODULE_ID_process_float(MODULE_ID_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames) {
    (void)in_left;
    (void)in_right;
    if (!s || !out_left || !out_right) return;

    float bend_mul = powf(2.0f, s->pitch_bend * 2.0f / 12.0f);
    float attack_coeff = 1.0f - expf(-1.0f / (0.005f * MOVEFORGE_SAMPLE_RATE));
    float release_coeff = 1.0f - expf(-1.0f / (0.4f * MOVEFORGE_SAMPLE_RATE));

    for (int i = 0; i < frames; i++) {
        s->freq += (s->target_freq * bend_mul - s->freq) * 0.001f;
        if (s->gate > 0.5f) s->env += (1.0f - s->env) * attack_coeff;
        else                s->env += (0.0f - s->env) * release_coeff;
        s->phase += s->freq / MOVEFORGE_SAMPLE_RATE;
        if (s->phase >= 1.0f) s->phase -= floorf(s->phase);

        float carrier = sinf(MOVEFORGE_TWO_PI * s->phase);
        float shaped = carrier * (1.0f - s->tone) + tanhf(carrier * (1.0f + s->tone * 4.0f)) * s->tone;
        float amp = s->volume * (0.2f + 0.8f * s->velocity) * s->env;
        float y = shaped * amp;
        out_left[i] = y;
        out_right[i] = y;
    }
}

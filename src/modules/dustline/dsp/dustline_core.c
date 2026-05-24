#include "dustline_core.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

#define SR 44100.0f
#define TWO_PI 6.2831853071795864769f

static float clampf_local(float x, float lo, float hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

static float midi_to_hz(int note) {
    return 440.0f * powf(2.0f, ((float)note - 69.0f) / 12.0f);
}

static float next_noise(dustline_core_t *s) {
    uint32_t x = (uint32_t)(s->rng * 4294967295.0f);
    if (x == 0) x = 0x12345678u;
    x = x * 1664525u + 1013904223u;
    s->rng = (float)x / 4294967295.0f;
    return s->rng * 2.0f - 1.0f;
}

void dustline_init(dustline_core_t *s) {
    memset(s, 0, sizeof(*s));
    s->active_note = -1;
    s->rng = 0.37f;
    s->volume = 0.72f;
    s->wave = 0.35f;
    s->noise = 0.18f;
    s->cutoff = 0.42f;
    s->resonance = 0.18f;
    s->attack = 0.008f;
    s->release = 0.55f;
    s->drive = 0.22f;
    s->bend_range = 2.0f;
}

int dustline_param_id(const char *key) {
    if (!key) return -1;
    if (strcmp(key, "volume") == 0) return DUSTLINE_PARAM_VOLUME;
    if (strcmp(key, "wave") == 0) return DUSTLINE_PARAM_WAVE;
    if (strcmp(key, "noise") == 0) return DUSTLINE_PARAM_NOISE;
    if (strcmp(key, "cutoff") == 0) return DUSTLINE_PARAM_CUTOFF;
    if (strcmp(key, "resonance") == 0) return DUSTLINE_PARAM_RESONANCE;
    if (strcmp(key, "attack") == 0) return DUSTLINE_PARAM_ATTACK;
    if (strcmp(key, "release") == 0) return DUSTLINE_PARAM_RELEASE;
    if (strcmp(key, "drive") == 0) return DUSTLINE_PARAM_DRIVE;
    if (strcmp(key, "bend_range") == 0) return DUSTLINE_PARAM_BEND_RANGE;
    return -1;
}

void dustline_set_param(dustline_core_t *s, int param_id, float value) {
    if (!s) return;
    if (param_id == DUSTLINE_PARAM_VOLUME) s->volume = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == DUSTLINE_PARAM_WAVE) s->wave = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == DUSTLINE_PARAM_NOISE) s->noise = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == DUSTLINE_PARAM_CUTOFF) s->cutoff = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == DUSTLINE_PARAM_RESONANCE) s->resonance = clampf_local(value, 0.0f, 0.95f);
    else if (param_id == DUSTLINE_PARAM_ATTACK) s->attack = clampf_local(value, 0.001f, 2.0f);
    else if (param_id == DUSTLINE_PARAM_RELEASE) s->release = clampf_local(value, 0.02f, 6.0f);
    else if (param_id == DUSTLINE_PARAM_DRIVE) s->drive = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == DUSTLINE_PARAM_BEND_RANGE) s->bend_range = clampf_local(value, 0.0f, 12.0f);
}

float dustline_get_param(const dustline_core_t *s, int param_id) {
    if (!s) return 0.0f;
    if (param_id == DUSTLINE_PARAM_VOLUME) return s->volume;
    if (param_id == DUSTLINE_PARAM_WAVE) return s->wave;
    if (param_id == DUSTLINE_PARAM_NOISE) return s->noise;
    if (param_id == DUSTLINE_PARAM_CUTOFF) return s->cutoff;
    if (param_id == DUSTLINE_PARAM_RESONANCE) return s->resonance;
    if (param_id == DUSTLINE_PARAM_ATTACK) return s->attack;
    if (param_id == DUSTLINE_PARAM_RELEASE) return s->release;
    if (param_id == DUSTLINE_PARAM_DRIVE) return s->drive;
    if (param_id == DUSTLINE_PARAM_BEND_RANGE) return s->bend_range;
    return 0.0f;
}

void dustline_note_on(dustline_core_t *s, int note, float velocity) {
    if (!s) return;
    s->active_note = note;
    s->target_freq = midi_to_hz(note);
    if (s->freq <= 0.0f) s->freq = s->target_freq;
    s->velocity = clampf_local(velocity, 0.0f, 1.0f);
    s->gate = 1.0f;
}

void dustline_note_off(dustline_core_t *s, int note) {
    if (!s) return;
    if (s->active_note == note) {
        s->gate = 0.0f;
        s->active_note = -1;
    }
}

void dustline_all_notes_off(dustline_core_t *s) {
    if (!s) return;
    s->gate = 0.0f;
    s->active_note = -1;
}

void dustline_pitch_bend(dustline_core_t *s, float bend) {
    if (!s) return;
    s->pitch_bend = clampf_local(bend, -1.0f, 1.0f);
}

void dustline_render_float(dustline_core_t *s, float *left, float *right, int frames) {
    if (!s || !left || !right) return;

    for (int i = 0; i < frames; i++) {
        float bend_mul = powf(2.0f, (s->pitch_bend * s->bend_range) / 12.0f);
        s->freq += (s->target_freq * bend_mul - s->freq) * 0.002f;

        float attack_coeff = 1.0f - expf(-1.0f / (s->attack * SR));
        float release_coeff = 1.0f - expf(-1.0f / (s->release * SR));
        s->env += ((s->gate > 0.5f ? 1.0f : 0.0f) - s->env) * (s->gate > 0.5f ? attack_coeff : release_coeff);

        s->phase += clampf_local(s->freq, 1.0f, 16000.0f) / SR;
        s->sub_phase += clampf_local(s->freq * 0.5f, 1.0f, 16000.0f) / SR;
        if (s->phase >= 1.0f) s->phase -= floorf(s->phase);
        if (s->sub_phase >= 1.0f) s->sub_phase -= floorf(s->sub_phase);

        float saw = s->phase * 2.0f - 1.0f;
        float pulse = s->phase < (0.12f + s->wave * 0.76f) ? 1.0f : -1.0f;
        float tri = 4.0f * fabsf(s->phase - 0.5f) - 1.0f;
        float osc_a = saw * (1.0f - s->wave) + pulse * s->wave;
        float sub = (s->sub_phase < 0.5f ? 1.0f : -1.0f) * 0.38f;
        float source = osc_a * 0.72f + tri * 0.18f + sub;
        source = source * (1.0f - s->noise) + next_noise(s) * s->noise;

        float cutoff_hz = 70.0f + powf(s->cutoff, 2.2f) * 14000.0f;
        float f = clampf_local(2.0f * sinf((TWO_PI * 0.5f) * cutoff_hz / SR), 0.002f, 0.95f);
        float q = 0.35f + s->resonance * 3.8f;
        s->lp += f * s->bp;
        float hp = source - s->lp - q * s->bp;
        s->bp += f * hp;

        float amp = s->volume * (0.12f + 0.88f * s->velocity) * s->env;
        float gain = 1.0f + s->drive * 12.0f;
        float y = tanhf(s->lp * gain) * amp;
        left[i] = clampf_local(y, -1.0f, 1.0f);
        right[i] = left[i];
    }
}

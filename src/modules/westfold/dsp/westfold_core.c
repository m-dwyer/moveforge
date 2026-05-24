#include "westfold_core.h"

#include <math.h>
#include <string.h>

#define SR 44100.0f
#define TWO_PI 6.2831853071795864769f

static float clampf_local(float x, float lo, float hi) {
    return x < lo ? lo : (x > hi ? hi : x);
}

static float midi_to_hz(int note) {
    return 440.0f * powf(2.0f, ((float)note - 69.0f) / 12.0f);
}

static float fold_sample(float x, float amount) {
    float gain = 1.0f + amount * 9.0f;
    x *= gain;
    for (int i = 0; i < 4; i++) {
        if (x > 1.0f) x = 2.0f - x;
        if (x < -1.0f) x = -2.0f - x;
    }
    return clampf_local(x, -1.0f, 1.0f);
}

void westfold_init(westfold_core_t *s) {
    memset(s, 0, sizeof(*s));
    s->active_note = -1;
    s->volume = 0.75f;
    s->ratio = 1.5f;
    s->fm = 0.15f;
    s->fold = 0.35f;
    s->lpg = 0.55f;
    s->decay = 0.45f;
    s->release = 0.8f;
    s->bend_range = 2.0f;
}

int westfold_param_id(const char *key) {
    if (!key) return -1;
    if (strcmp(key, "volume") == 0) return WESTFOLD_PARAM_VOLUME;
    if (strcmp(key, "ratio") == 0) return WESTFOLD_PARAM_RATIO;
    if (strcmp(key, "fm") == 0) return WESTFOLD_PARAM_FM;
    if (strcmp(key, "fold") == 0) return WESTFOLD_PARAM_FOLD;
    if (strcmp(key, "lpg") == 0) return WESTFOLD_PARAM_LPG;
    if (strcmp(key, "decay") == 0) return WESTFOLD_PARAM_DECAY;
    if (strcmp(key, "release") == 0) return WESTFOLD_PARAM_RELEASE;
    if (strcmp(key, "bend_range") == 0) return WESTFOLD_PARAM_BEND_RANGE;
    return -1;
}

void westfold_set_param(westfold_core_t *s, int param_id, float value) {
    if (!s) return;
    if (param_id == WESTFOLD_PARAM_VOLUME) s->volume = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == WESTFOLD_PARAM_RATIO) s->ratio = clampf_local(value, 0.25f, 4.0f);
    else if (param_id == WESTFOLD_PARAM_FM) s->fm = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == WESTFOLD_PARAM_FOLD) s->fold = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == WESTFOLD_PARAM_LPG) s->lpg = clampf_local(value, 0.0f, 1.0f);
    else if (param_id == WESTFOLD_PARAM_DECAY) s->decay = clampf_local(value, 0.02f, 4.0f);
    else if (param_id == WESTFOLD_PARAM_RELEASE) s->release = clampf_local(value, 0.02f, 6.0f);
    else if (param_id == WESTFOLD_PARAM_BEND_RANGE) s->bend_range = clampf_local(value, 0.0f, 12.0f);
}

float westfold_get_param(const westfold_core_t *s, int param_id) {
    if (!s) return 0.0f;
    if (param_id == WESTFOLD_PARAM_VOLUME) return s->volume;
    if (param_id == WESTFOLD_PARAM_RATIO) return s->ratio;
    if (param_id == WESTFOLD_PARAM_FM) return s->fm;
    if (param_id == WESTFOLD_PARAM_FOLD) return s->fold;
    if (param_id == WESTFOLD_PARAM_LPG) return s->lpg;
    if (param_id == WESTFOLD_PARAM_DECAY) return s->decay;
    if (param_id == WESTFOLD_PARAM_RELEASE) return s->release;
    if (param_id == WESTFOLD_PARAM_BEND_RANGE) return s->bend_range;
    return 0.0f;
}

void westfold_note_on(westfold_core_t *s, int note, float velocity) {
    if (!s) return;
    s->active_note = note;
    s->target_freq = midi_to_hz(note);
    if (s->freq <= 0.0f) s->freq = s->target_freq;
    s->velocity = clampf_local(velocity, 0.0f, 1.0f);
    s->gate = 1.0f;
}

void westfold_note_off(westfold_core_t *s, int note) {
    if (!s) return;
    if (s->active_note == note) {
        s->gate = 0.0f;
        s->active_note = -1;
    }
}

void westfold_all_notes_off(westfold_core_t *s) {
    if (!s) return;
    s->gate = 0.0f;
    s->active_note = -1;
}

void westfold_pitch_bend(westfold_core_t *s, float bend) {
    if (!s) return;
    s->pitch_bend = clampf_local(bend, -1.0f, 1.0f);
}

void westfold_render_float(westfold_core_t *s, float *left, float *right, int frames) {
    if (!s || !left || !right) return;

    for (int i = 0; i < frames; i++) {
        float bend_mul = powf(2.0f, (s->pitch_bend * s->bend_range) / 12.0f);
        s->freq += (s->target_freq * bend_mul - s->freq) * 0.0015f;

        float attack_coeff = 1.0f - expf(-1.0f / (0.006f * SR));
        float decay_coeff = 1.0f - expf(-1.0f / (s->decay * SR));
        float release_coeff = 1.0f - expf(-1.0f / (s->release * SR));
        if (s->gate > 0.5f) {
            float coeff = s->env < 0.95f ? attack_coeff : decay_coeff;
            s->env += (1.0f - s->env) * coeff;
        } else {
            s->env += (0.0f - s->env) * release_coeff;
        }

        float mod = sinf(TWO_PI * s->phase_b);
        float freq_a = s->freq * (1.0f + mod * s->fm * 2.0f);
        float freq_b = s->freq * s->ratio;
        s->phase_a += clampf_local(freq_a, 1.0f, 16000.0f) / SR;
        s->phase_b += clampf_local(freq_b, 1.0f, 16000.0f) / SR;
        if (s->phase_a >= 1.0f) s->phase_a -= floorf(s->phase_a);
        if (s->phase_b >= 1.0f) s->phase_b -= floorf(s->phase_b);

        float carrier = sinf(TWO_PI * s->phase_a);
        float shaped = fold_sample(carrier + 0.35f * mod, s->fold);
        float lpg_env = s->env * s->env;
        float cutoff = 90.0f + (12000.0f * (0.08f + s->lpg * 0.92f) * lpg_env);
        float alpha = clampf_local(TWO_PI * cutoff / SR, 0.001f, 0.95f);
        s->lp += alpha * (shaped - s->lp);

        float amp = s->volume * (0.15f + 0.85f * s->velocity) * lpg_env;
        float y = tanhf(s->lp * amp * 1.25f);
        left[i] = y;
        right[i] = y;
    }
}

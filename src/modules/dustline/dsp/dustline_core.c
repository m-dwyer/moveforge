#include "dustline_core.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

#include "dustline_params.gen.inc"

#include "modules/_shared/dsp_runtime.h"

static float next_noise(dustline_core_t *s) {
    uint32_t x = (uint32_t)(s->rng * 4294967295.0f);
    if (x == 0) x = 0x12345678u;
    x = x * 1664525u + 1013904223u;
    s->rng = (float)x / 4294967295.0f;
    return s->rng * 2.0f - 1.0f;
}

/* `resonance` is declared 0..0.95 in module.json; mf_svf_set wants 0..1. */
#define DUSTLINE_RESONANCE_MAX 0.95f

void dustline_init(dustline_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    s->active_note = -1;
    s->rng = 0.37f;
    mf_svf_init(&s->svf);
    dustline_apply_defaults(s);
}

void dustline_note_on(dustline_core_t *s, int note, float velocity) {
    if (!s) return;
    s->active_note = note;
    s->target_freq = moveforge_midi_note_to_hz((float)note);
    if (s->freq <= 0.0f) s->freq = s->target_freq;
    s->velocity = moveforge_clampf(velocity, 0.0f, 1.0f);
    s->gate = 1.0f;
    /* The ZDF SVF is unconditionally stable, so filter state can only go
     * non-finite if something upstream fed it a non-finite sample. Reset
     * rather than let it persist for the life of the instance. */
    if (!isfinite(s->svf.ic1eq) || !isfinite(s->svf.ic2eq)) mf_svf_init(&s->svf);
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
    s->pitch_bend = moveforge_clampf(bend, -1.0f, 1.0f);
}

void dustline_process_float(dustline_core_t *s,
                            const float *in_left, const float *in_right,
                            float *out_left, float *out_right,
                            int frames) {
    (void)in_left;
    (void)in_right;
    if (!s || !out_left || !out_right) return;
    float *left = out_left;
    float *right = out_right;

    /* Filter coefficients are block-constant: cutoff and resonance only change
     * when the host delivers a parameter, which happens between blocks. Keeps
     * tanf out of the sample loop. */
    float cutoff_hz = 70.0f + powf(s->cutoff, 2.2f) * 14000.0f;
    mf_svf_coeffs_t svf_c;
    mf_svf_set(&svf_c, cutoff_hz, s->resonance / DUSTLINE_RESONANCE_MAX);

    for (int i = 0; i < frames; i++) {
        float bend_mul = powf(2.0f, (s->pitch_bend * s->bend_range) / 12.0f);
        s->freq += (s->target_freq * bend_mul - s->freq) * 0.002f;

        float attack_coeff = 1.0f - expf(-1.0f / (s->attack * MOVEFORGE_SAMPLE_RATE));
        float release_coeff = 1.0f - expf(-1.0f / (s->release * MOVEFORGE_SAMPLE_RATE));
        s->env += ((s->gate > 0.5f ? 1.0f : 0.0f) - s->env) * (s->gate > 0.5f ? attack_coeff : release_coeff);

        s->phase += moveforge_clampf(s->freq, 1.0f, 16000.0f) / MOVEFORGE_SAMPLE_RATE;
        s->sub_phase += moveforge_clampf(s->freq * 0.5f, 1.0f, 16000.0f) / MOVEFORGE_SAMPLE_RATE;
        if (s->phase >= 1.0f) s->phase -= floorf(s->phase);
        if (s->sub_phase >= 1.0f) s->sub_phase -= floorf(s->sub_phase);

        float saw = s->phase * 2.0f - 1.0f;
        float pulse = s->phase < (0.12f + s->wave * 0.76f) ? 1.0f : -1.0f;
        float tri = 4.0f * fabsf(s->phase - 0.5f) - 1.0f;
        float osc_a = saw * (1.0f - s->wave) + pulse * s->wave;
        float sub = (s->sub_phase < 0.5f ? 1.0f : -1.0f) * 0.38f;
        float source = osc_a * 0.72f + tri * 0.18f + sub;
        source = source * (1.0f - s->noise) + next_noise(s) * s->noise;

        mf_svf_tick(&s->svf, &svf_c, source);

        float output_gain = s->volume;
        float amp = (0.12f + 0.88f * s->velocity) * s->env;
        float gain = 1.0f + s->drive * 12.0f;
        float y = tanhf(s->svf.lp * gain) * amp * 0.96f;
        float hp_out = y - s->hp_x + 0.995f * s->hp_y;
        s->hp_x = y;
        s->hp_y = hp_out;
        y = tanhf(hp_out) * output_gain * 0.94f;
        left[i] = moveforge_clampf(y, -1.0f, 1.0f);
        right[i] = left[i];
    }
}

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

void dustline_init(dustline_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    s->active_note = -1;
    s->rng = 0.37f;
    dustline_apply_defaults(s);
}

void dustline_note_on(dustline_core_t *s, int note, float velocity) {
    if (!s) return;
    s->active_note = note;
    s->target_freq = moveforge_midi_note_to_hz((float)note);
    if (s->freq <= 0.0f) s->freq = s->target_freq;
    s->velocity = moveforge_clampf(velocity, 0.0f, 1.0f);
    s->gate = 1.0f;
    /* Recover from any non-finite filter state left over from a prior
     * unstable run (e.g. user loaded an older build that hit the SVF
     * stability bug). */
    if (!(s->lp == s->lp) || s->lp > 1e6f || s->lp < -1e6f) s->lp = 0.0f;
    if (!(s->bp == s->bp) || s->bp > 1e6f || s->bp < -1e6f) s->bp = 0.0f;
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

        float cutoff_hz = 70.0f + powf(s->cutoff, 2.2f) * 14000.0f;
        float f = moveforge_clampf(2.0f * sinf((MOVEFORGE_TWO_PI * 0.5f) * cutoff_hz / MOVEFORGE_SAMPLE_RATE), 0.002f, 0.95f);
        /* Chamberlin SVF is conditionally stable: f*q must stay below ~2.
         * Cap q to 1.8/f so high cutoff + high resonance can't blow up
         * (was producing NaN at e.g. cutoff=0.86, resonance=0.76). */
        float q_desired = 0.35f + s->resonance * 3.8f;
        float q_max = 1.8f / (f + 1e-6f);
        float q = q_desired < q_max ? q_desired : q_max;
        s->lp += f * s->bp;
        float hp = source - s->lp - q * s->bp;
        s->bp += f * hp;

        float amp = s->volume * (0.12f + 0.88f * s->velocity) * s->env;
        float gain = 1.0f + s->drive * 12.0f;
        float y = tanhf(s->lp * gain) * amp;
        left[i] = moveforge_clampf(y, -1.0f, 1.0f);
        right[i] = left[i];
    }
}

#include "dustline_core.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

#include "dustline_params.gen.inc"

#include "modules/_shared/dsp_runtime.h"

/* `resonance` is declared 0..0.95 in module.json; mf_svf_set wants 0..1. */
#define DUSTLINE_RESONANCE_MAX 0.95f

void dustline_init(dustline_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    s->active_note = -1;
    mf_rng_init(&s->rng, 0x5eed1234u);
    mf_svf_init(&s->svf);
    mf_dcblock_init(&s->dc_pre);
    mf_dcblock_init(&s->dc_post);
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

    /* Every one of these depends only on parameters, which the host can change
     * between blocks but never within one — so computing them per sample was
     * pure waste: one powf and two expf on every sample, about 260 cycles.
     * Hoisting is bit-identical, not an approximation. */
    float bend_mul = powf(2.0f, (s->pitch_bend * s->bend_range) / 12.0f);
    float attack_coeff = mf_env_coeff_seconds(s->attack);
    float release_coeff = mf_env_coeff_seconds(s->release);
    float target_freq_bent = s->target_freq * bend_mul;

    for (int i = 0; i < frames; i++) {
        s->freq += (target_freq_bent - s->freq) * 0.002f;

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
        source = source * (1.0f - s->noise) + mf_rng_bipolar(&s->rng) * s->noise;

        mf_svf_tick(&s->svf, &svf_c, source);

        float output_gain = s->volume;
        float amp = (0.12f + 0.88f * s->velocity) * s->env;
        float gain = 1.0f + s->drive * 12.0f;
        float y = tanhf(s->svf.lp * gain) * amp * 0.96f;
        y = mf_dcblock_tick(&s->dc_pre, y);
        y = tanhf(y);
        /* The output tanh above reintroduces DC whenever the waveform is
         * asymmetric (a narrow pulse at high `wave`, for instance), so a
         * blocker has to run after it too — dust-bass measured 4.5% DC with
         * only the upstream one.
         *
         * It runs before the volume scale, not after: a highpass after the gain
         * has decaying state, so volume=0 would leave a ~10 ms tail instead of
         * muting. A constant gain cannot reintroduce DC, so blocking first is
         * both correct and hard-mutable. */
        y = mf_dcblock_tick(&s->dc_post, y);
        /* 0.78, not 0.94: removing the DC offset freed up peak headroom, so the
         * same nominal level now swings further. Measured pre-clamp peak at
         * volume=max was 1.084 (defaults) and 1.138 (all-hot), i.e. the output
         * was hard-clipping in moveforge_float_to_i16. This lands the worst case
         * near 0.89 and keeps margin against the stress gate's 0.995. */
        y = y * output_gain * 0.78f;
        left[i] = moveforge_clampf(y, -1.0f, 1.0f);
        right[i] = left[i];
    }
}

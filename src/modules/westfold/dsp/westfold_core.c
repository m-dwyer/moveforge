#include "westfold_core.h"

#include <math.h>
#include <string.h>

#include "westfold_params.gen.inc"

#include "modules/_shared/dsp_runtime.h"

static float fold_sample(float x, float amount)
{
    float gain = 1.0f + amount * 9.0f;
    x *= gain;
    for (int i = 0; i < 4; i++)
    {
        if (x > 1.0f)
            x = 2.0f - x;
        if (x < -1.0f)
            x = -2.0f - x;
    }
    return moveforge_clampf(x, -1.0f, 1.0f);
}

void westfold_init(westfold_core_t *s)
{
    if (!s)
        return;
    memset(s, 0, sizeof(*s));
    s->active_note = -1;
    westfold_apply_defaults(s);
}

void westfold_note_on(westfold_core_t *s, int note, float velocity)
{
    if (!s)
        return;
    s->active_note = note;
    s->target_freq = moveforge_midi_note_to_hz((float)note);
    if (s->freq <= 0.0f)
        s->freq = s->target_freq;
    s->velocity = moveforge_clampf(velocity, 0.0f, 1.0f);
    s->gate = 1.0f;
}

void westfold_note_off(westfold_core_t *s, int note)
{
    if (!s)
        return;
    if (s->active_note == note)
    {
        s->gate = 0.0f;
        s->active_note = -1;
    }
}

void westfold_all_notes_off(westfold_core_t *s)
{
    if (!s)
        return;
    s->gate = 0.0f;
    s->active_note = -1;
}

void westfold_pitch_bend(westfold_core_t *s, float bend)
{
    if (!s)
        return;
    s->pitch_bend = moveforge_clampf(bend, -1.0f, 1.0f);
}

void westfold_process_float(westfold_core_t *s,
                            const float *in_left, const float *in_right,
                            float *out_left, float *out_right,
                            int frames)
{
    (void)in_left;
    (void)in_right;
    if (!s || !out_left || !out_right)
        return;
    float *left = out_left;
    float *right = out_right;

    for (int i = 0; i < frames; i++)
    {
        float bend_mul = powf(2.0f, (s->pitch_bend * s->bend_range) / 12.0f);
        s->freq += (s->target_freq * bend_mul - s->freq) * 0.0015f;

        float attack_coeff = 1.0f - expf(-1.0f / (0.006f * MOVEFORGE_SAMPLE_RATE));
        float decay_coeff = 1.0f - expf(-1.0f / (s->decay * MOVEFORGE_SAMPLE_RATE));
        float release_coeff = 1.0f - expf(-1.0f / (s->release * MOVEFORGE_SAMPLE_RATE));
        if (s->gate > 0.5f)
        {
            float coeff = s->env < 0.95f ? attack_coeff : decay_coeff;
            s->env += (1.0f - s->env) * coeff;
        }
        else
        {
            s->env += (0.0f - s->env) * release_coeff;
        }

        float mod = sinf(MOVEFORGE_TWO_PI * s->phase_b);
        float freq_a = s->freq * (1.0f + mod * s->fm * 2.0f);
        float freq_b = s->freq * s->ratio;
        s->phase_a += moveforge_clampf(freq_a, 1.0f, 16000.0f) / MOVEFORGE_SAMPLE_RATE;
        s->phase_b += moveforge_clampf(freq_b, 1.0f, 16000.0f) / MOVEFORGE_SAMPLE_RATE;
        if (s->phase_a >= 1.0f)
            s->phase_a -= floorf(s->phase_a);
        if (s->phase_b >= 1.0f)
            s->phase_b -= floorf(s->phase_b);

        float carrier = sinf(MOVEFORGE_TWO_PI * s->phase_a);
        float shaped = fold_sample(carrier + 0.35f * mod, s->fold);
        float lpg_env = s->env * s->env;
        float cutoff = 90.0f + (12000.0f * (0.08f + s->lpg * 0.92f) * lpg_env);
        float alpha = moveforge_clampf(MOVEFORGE_TWO_PI * cutoff / MOVEFORGE_SAMPLE_RATE, 0.001f, 0.95f);
        s->lp += alpha * (shaped - s->lp);

        float amp = s->volume * (0.15f + 0.85f * s->velocity) * lpg_env;
        float y = tanhf(s->lp * amp * 1.25f);
        left[i] = y;
        right[i] = y;
    }
}

#include "westfold_core.h"

#include <math.h>
#include <string.h>

#include "westfold_params.gen.inc"

#include "modules/_shared/dsp_runtime.h"

static float note_hash(int note)
{
    float x = sinf((float)(note * 127 + 13) * 12.9898f) * 43758.5453f;
    return (x - floorf(x)) * 2.0f - 1.0f;
}

static float wrap_phase(float phase)
{
    phase -= floorf(phase);
    return phase < 0.0f ? phase + 1.0f : phase;
}

static float one_pole_coeff(float hz)
{
    return moveforge_clampf(MOVEFORGE_TWO_PI * hz / MOVEFORGE_SAMPLE_RATE, 0.0002f, 0.95f);
}

static float fold_sample(float x, float fold, float drive, float bias)
{
    float gain = 1.0f + fold * 10.0f + drive * 5.0f;
    x = tanhf((x + bias) * gain * (0.65f + 0.35f * drive));
    x *= 1.0f + fold * 5.0f;

    for (int i = 0; i < 5; i++)
    {
        if (x > 1.0f)
            x = 2.0f - x;
        if (x < -1.0f)
            x = -2.0f - x;
    }

    x = tanhf(x * (1.05f + drive * 2.4f));
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
    s->env = 1.0f;
    s->strike_env = 1.0f;
    s->note_rand = note_hash(note);
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

        float decay_coeff = 1.0f - expf(-1.0f / (s->decay * MOVEFORGE_SAMPLE_RATE));
        float release_coeff = 1.0f - expf(-1.0f / (s->release * MOVEFORGE_SAMPLE_RATE));
        float strike_time = 0.012f + (1.0f - s->strike) * 0.18f;
        float strike_coeff = 1.0f - expf(-1.0f / (strike_time * MOVEFORGE_SAMPLE_RATE));
        if (s->gate > 0.5f)
        {
            float hold = 0.015f + (1.0f - s->strike) * 0.18f;
            s->env += (hold - s->env) * decay_coeff;
        }
        else
        {
            s->env += (0.0f - s->env) * release_coeff;
        }
        s->strike_env += (0.0f - s->strike_env) * strike_coeff;

        float chaos_rate = 0.07f + s->chaos * 1.7f + s->freq * 0.00003f;
        s->chaos_phase = wrap_phase(s->chaos_phase + chaos_rate / MOVEFORGE_SAMPLE_RATE);
        float chaos_slow = sinf(MOVEFORGE_TWO_PI * s->chaos_phase + s->note_rand * 1.7f);
        float chaos_fast = sinf(MOVEFORGE_TWO_PI * (s->phase_b * 0.5f + s->phase_a) + s->note_rand);
        float chaos_amt = s->chaos * (0.55f + 0.45f * s->strike_env);

        float ratio_spread = expf((s->note_rand * 0.035f + chaos_slow * 0.055f) * chaos_amt);
        float ratio_eff = moveforge_clampf(s->ratio * ratio_spread, 0.125f, 8.0f);
        float freq_b = s->freq * ratio_eff;
        s->phase_a = wrap_phase(s->phase_a + moveforge_clampf(s->freq, 1.0f, 16000.0f) / MOVEFORGE_SAMPLE_RATE);
        s->phase_b = wrap_phase(s->phase_b + moveforge_clampf(freq_b, 1.0f, 16000.0f) / MOVEFORGE_SAMPLE_RATE);

        float mod = sinf(MOVEFORGE_TWO_PI * s->phase_b);
        float tri_mod = 4.0f * fabsf(s->phase_b - 0.5f) - 1.0f;
        float pm_index = s->fm * (0.2f + 4.2f * s->fm) + chaos_amt * 1.15f;
        float phase_mod = mod * pm_index + tri_mod * s->strike_env * s->strike * 0.35f;
        phase_mod += s->lp * s->chaos * 0.32f;

        float carrier = sinf(MOVEFORGE_TWO_PI * wrap_phase(s->phase_a + phase_mod * 0.08f));
        float fold_amt = moveforge_clampf(s->fold + chaos_fast * s->chaos * 0.18f, 0.0f, 1.0f);
        float bias = (s->note_rand * 0.08f + chaos_slow * 0.11f) * s->chaos + s->strike_env * s->strike * 0.04f;
        float source = carrier + mod * (0.22f + s->fm * 0.25f) + tri_mod * s->strike_env * s->strike * 0.18f;
        float shaped = fold_sample(source, fold_amt, s->drive, bias);

        float amp_env = s->env * s->env;
        float bright_env = moveforge_clampf(amp_env * (0.35f + s->lpg) + s->strike_env * (0.18f + s->strike * 1.2f), 0.0f, 1.35f);
        float cutoff = 45.0f + powf(moveforge_clampf(bright_env, 0.0f, 1.0f), 1.8f) * (2600.0f + s->lpg * 12500.0f);
        cutoff += s->drive * 650.0f + s->chaos * chaos_fast * 1200.0f * bright_env;
        float alpha = one_pole_coeff(moveforge_clampf(cutoff, 35.0f, 17000.0f));
        s->lp += alpha * (shaped - s->lp);

        float amp = s->volume * (0.12f + 0.88f * s->velocity) * amp_env;
        float driven = tanhf(s->lp * (1.1f + s->drive * 5.5f));
        float y = driven * amp * (1.0f + s->drive * 0.3f);

        float hp = y - s->hp_x + 0.995f * s->hp_y;
        s->hp_x = y;
        s->hp_y = hp;
        y = tanhf(hp * 1.18f);
        left[i] = y;
        right[i] = tanhf((hp + s->chaos * 0.035f * amp_env * (shaped - s->lp)) * 1.18f);
    }
}

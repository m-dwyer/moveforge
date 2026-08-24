#include "vca_core.h"

#include <string.h>
#include "vca_params.gen.inc"
#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/mf_dsp.h"

/* Every stage aims this far past where it is going, as a share of the distance
 * it has to cross, and snaps on arrival. A stage that merely approached its
 * destination would never reach it, and the seconds on the encoder would name
 * a time constant rather than a duration. The Amp page draws all three stages
 * against one axis by their declared seconds, so the seconds have to be what
 * the stage actually takes. */
#define VCA_ARRIVAL_OVERSHOOT 0.2f
#define VCA_ARRIVAL_TAU_SCALE 1.7917595f /* ln(1 + 1 / VCA_ARRIVAL_OVERSHOOT) */
#define VCA_ATTACK_TARGET (1.0f + VCA_ARRIVAL_OVERSHOOT)
#define VCA_RELEASE_TARGET (-VCA_ARRIVAL_OVERSHOOT)

/* Loud enough for the ear to hear the chain stop. Below this the first note may
 * start from silence, because there is nothing for it to cut. */
#define VCA_SOUNDING_LEVEL 1.0e-4f

static void refresh_coefficients(vca_core_t *s)
{
    /* Recomputed only when a time actually moved: this runs per block, and an
     * expf per sample is the one thing a gain stage cannot afford. */
    if (s->attack != s->coeff_attack_seconds) {
        s->coeff_attack_seconds = s->attack;
        s->attack_coeff = mf_env_coeff_seconds(s->attack / VCA_ARRIVAL_TAU_SCALE);
    }
    if (s->decay != s->coeff_decay_seconds) {
        s->coeff_decay_seconds = s->decay;
        s->decay_coeff = mf_env_coeff_seconds(s->decay / VCA_ARRIVAL_TAU_SCALE);
    }
    if (s->release != s->coeff_release_seconds) {
        s->coeff_release_seconds = s->release;
        s->release_coeff = mf_env_coeff_seconds(s->release / VCA_ARRIVAL_TAU_SCALE);
    }
}

static int any_held(const vca_core_t *s)
{
    return (s->held[0] | s->held[1] | s->held[2] | s->held[3]) != 0u;
}

void vca_init(vca_core_t *s)
{
    if (!s) return;
    memset(s, 0, sizeof(*s));
    vca_apply_defaults(s);
    s->stage = VCA_STAGE_IDLE;
    /* Nothing has been asked for yet, so no coefficient matches its time. */
    s->coeff_attack_seconds = -1.0f;
    s->coeff_decay_seconds = -1.0f;
    s->coeff_release_seconds = -1.0f;
}

void vca_handle_midi(vca_core_t *s, int status, int d1, int d2)
{
    int note;
    int on;
    if (!s) return;
    if (d1 < 0 || d1 > 127) return;

    on = ((status & 0xF0) == 0x90) && d2 > 0;
    if (!on && (status & 0xF0) != 0x80 && !(((status & 0xF0) == 0x90) && d2 == 0))
        return;

    note = d1;
    if (on) {
        s->held[note >> 5] |= 1u << (note & 31);
        /* The first note is the one that takes the gain away from the input.
         * Where it takes it from is decided in the render, which is the only
         * place that knows whether the chain was sounding. */
        if (!s->armed) {
            s->armed = 1;
            s->arming = 1;
        }
        s->stage = VCA_STAGE_ATTACK;
        return;
    }
    s->held[note >> 5] &= ~(1u << (note & 31));
    if (!any_held(s)) s->stage = VCA_STAGE_RELEASE;
}

void vca_all_notes_off(vca_core_t *s)
{
    if (!s) return;
    memset(s->held, 0, sizeof(s->held));
    if (s->armed) s->stage = VCA_STAGE_RELEASE;
}

void vca_process_float(vca_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames)
{
    int i;
    if (!s || !in_left || !in_right || !out_left || !out_right) return;

    /* No note has ever arrived, so the envelope does not own the gain yet and
     * the input passes untouched. Loading a VCA over a sounding chain must not
     * cut it. The peak is kept because the first note has to know whether it is
     * taking the gain from something the ear can hear. */
    if (!s->armed) {
        float peak = 0.0f;
        for (i = 0; i < frames; i++) {
            float left = in_left[i] < 0.0f ? -in_left[i] : in_left[i];
            float right = in_right[i] < 0.0f ? -in_right[i] : in_right[i];
            if (left > peak) peak = left;
            if (right > peak) peak = right;
        }
        s->passthrough_peak = peak;
        if (out_left != in_left) memcpy(out_left, in_left, (size_t)frames * sizeof(float));
        if (out_right != in_right) memcpy(out_right, in_right, (size_t)frames * sizeof(float));
        return;
    }

    /* The gain in force up to here was 1. Continue from it where the chain was
     * sounding, so taking the gain is a handover rather than a step from 1 to 0
     * in one sample; start from silence where nothing was sounding, so the
     * attack the player asked for is heard on the very first note. */
    if (s->arming) {
        s->arming = 0;
        if (s->passthrough_peak > VCA_SOUNDING_LEVEL) s->value = 1.0f;
    }

    refresh_coefficients(s);

    for (i = 0; i < frames; i++) {
        float gain;
        switch (s->stage) {
        case VCA_STAGE_ATTACK:
            s->value += (VCA_ATTACK_TARGET - s->value) * s->attack_coeff;
            if (s->value >= 1.0f) {
                s->value = 1.0f;
                s->stage = VCA_STAGE_DECAY;
            }
            break;
        case VCA_STAGE_DECAY: {
            /* Aiming past sustain only on the way down. A sustain the player
             * raises under a held note is approached from below, where an
             * ordinary one-pole already arrives from the correct side. */
            int falling = s->value > s->sustain;
            float target = falling
                ? s->sustain - VCA_ARRIVAL_OVERSHOOT * (1.0f - s->sustain)
                : s->sustain;
            s->value += (target - s->value) * s->decay_coeff;
            if (falling && s->value < s->sustain) s->value = s->sustain;
            break;
        }
        default:
            s->value += (VCA_RELEASE_TARGET - s->value) * s->release_coeff;
            if (s->value < 0.0f) s->value = 0.0f;
            break;
        }
        s->value = mf_flush_denorm(s->value);
        gain = moveforge_clampf(s->value, 0.0f, 1.0f);
        out_left[i] = in_left[i] * gain;
        out_right[i] = in_right[i] * gain;
    }
}

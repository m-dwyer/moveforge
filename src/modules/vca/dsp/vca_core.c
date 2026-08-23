#include "vca_core.h"

#include <string.h>
#include "vca_params.gen.inc"
#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/mf_dsp.h"

/* Attack aims past full so it arrives rather than approaching forever, and the
 * time constant is scaled so it crosses 1.0 in the stated seconds. Decay and
 * release are ordinary one-poles, which is what `sec` means everywhere else
 * here. */
#define VCA_ATTACK_TARGET 1.2f
#define VCA_ATTACK_TAU_SCALE 1.7917595f /* ln(VCA_ATTACK_TARGET / 0.2f) */

static void refresh_coefficients(vca_core_t *s)
{
    /* Recomputed only when a time actually moved: this runs per block, and an
     * expf per sample is the one thing a gain stage cannot afford. */
    if (s->attack != s->coeff_attack_seconds) {
        s->coeff_attack_seconds = s->attack;
        s->attack_coeff = mf_env_coeff_seconds(s->attack / VCA_ATTACK_TAU_SCALE);
    }
    if (s->decay != s->coeff_decay_seconds) {
        s->coeff_decay_seconds = s->decay;
        s->decay_coeff = mf_env_coeff_seconds(s->decay);
    }
    if (s->release != s->coeff_release_seconds) {
        s->coeff_release_seconds = s->release;
        s->release_coeff = mf_env_coeff_seconds(s->release);
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
        /* The first note is the one that takes the gain away from the input,
         * and it attacks from silence like every note after it. */
        s->armed = 1;
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
     * cut it. */
    if (!s->armed) {
        if (out_left != in_left) memcpy(out_left, in_left, (size_t)frames * sizeof(float));
        if (out_right != in_right) memcpy(out_right, in_right, (size_t)frames * sizeof(float));
        return;
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
        case VCA_STAGE_DECAY:
            s->value += (s->sustain - s->value) * s->decay_coeff;
            break;
        default:
            s->value += (0.0f - s->value) * s->release_coeff;
            break;
        }
        s->value = mf_flush_denorm(s->value);
        gain = moveforge_clampf(s->value, 0.0f, 1.0f);
        out_left[i] = in_left[i] * gain;
        out_right[i] = in_right[i] * gain;
    }
}

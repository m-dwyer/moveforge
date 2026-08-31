#include "vca_core.h"

#include <string.h>
#include "vca_params.gen.inc"
#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/mf_dsp.h"

/* Loud enough for the ear to hear the chain stop. Below this the first note may
 * start from silence, because there is nothing for it to cut. */
#define VCA_SOUNDING_LEVEL 1.0e-4f

void vca_init(vca_core_t *s)
{
    if (!s) return;
    memset(s, 0, sizeof(*s));
    vca_apply_defaults(s);
    mf_adsr_init(&s->env);
}

void vca_handle_midi(vca_core_t *s, int status, int d1, int d2)
{
    if (!s) return;
    /* The first note is the one that takes the gain away from the input. Where
     * it takes it from is decided in the render, which is the only place that
     * knows whether the chain was sounding. */
    if (mf_adsr_handle_midi(&s->env, status, d1, d2) && !s->armed) {
        s->armed = 1;
        s->arming = 1;
    }
}

void vca_all_notes_off(vca_core_t *s)
{
    mf_adsr_all_notes_off(&s->env);
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
        if (s->passthrough_peak > VCA_SOUNDING_LEVEL) s->env.value = 1.0f;
    }

    mf_adsr_set_times(&s->env, s->attack, s->decay, s->release);

    for (i = 0; i < frames; i++) {
        float gain = mf_adsr_tick(&s->env, s->sustain);
        out_left[i] = in_left[i] * gain;
        out_right[i] = in_right[i] * gain;
    }
}

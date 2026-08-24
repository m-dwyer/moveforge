#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "vca_core.h"

#define SR 44100

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

/* Runs DC through the VCA so the output reads back as the gain itself, and
 * answers with the gain at the end of the run. Incidental plumbing: every
 * assertion below is about the envelope, not about the signal. */
static float gain_after(vca_core_t *fx, float seconds) {
    static float in_l[SR], in_r[SR], out_l[SR], out_r[SR];
    int frames = (int)(seconds * (float)SR);
    int i;
    if (frames < 1) frames = 1;
    if (frames > SR) frames = SR;
    for (i = 0; i < frames; i++) { in_l[i] = 1.0f; in_r[i] = 1.0f; }
    vca_process_float(fx, in_l, in_r, out_l, out_r, frames);
    return out_l[frames - 1];
}

static void note_on(vca_core_t *fx, int note) { vca_handle_midi(fx, 0x90, note, 100); }
static void note_off(vca_core_t *fx, int note) { vca_handle_midi(fx, 0x80, note, 0); }

int main(void) {
    require_true(vca_param_id("sustain") >= 0, "param lookup works");
    require_true(vca_param_id("does_not_exist") < 0, "unknown param lookup fails");

    {
        /* A VCA nobody has played yet must not touch the audio, so adding one
         * to a sounding chain is inaudible rather than a cut. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("release"), 0.01f);
        require_true(gain_after(&fx, 0.5f) == 1.0f, "passes through before any note");
    }

    {
        /* A note opens the gate and the last note-off closes it. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("release"), 0.02f);
        note_on(&fx, 60);
        require_true(gain_after(&fx, 0.05f) > 0.99f, "a note opens the gate");
        note_off(&fx, 60);
        require_true(gain_after(&fx, 0.5f) < 0.01f, "a note-off closes the gate");
    }

    {
        /* Overlapping notes close on the last release, not the first: a count
         * would drift here, and an unmatched note-off must change nothing. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("release"), 0.02f);
        note_on(&fx, 60);
        note_on(&fx, 67);
        (void)gain_after(&fx, 0.05f);
        note_off(&fx, 60);
        note_off(&fx, 72);
        require_true(gain_after(&fx, 0.5f) > 0.99f, "stays open while a note is still held");
        note_off(&fx, 67);
        require_true(gain_after(&fx, 0.5f) < 0.01f, "closes when the last note ends");
    }

    {
        /* Panic reaches the VCA as all_notes_off, never as note-offs it can
         * match, so the gate has to close on that alone. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("release"), 0.02f);
        note_on(&fx, 60);
        note_on(&fx, 67);
        (void)gain_after(&fx, 0.05f);
        vca_all_notes_off(&fx);
        require_true(gain_after(&fx, 0.5f) < 0.01f, "all notes off closes the gate");
    }

    {
        /* Attack arrives in the time it says. An exponential approaching full
         * would never get there, so the stated seconds have to mean something. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("attack"), 0.1f);
        note_on(&fx, 60);
        require_true(gain_after(&fx, 0.01f) < 0.35f, "attack is still rising early on");
        require_true(gain_after(&fx, 0.1f) > 0.99f, "attack reaches full by its stated time");
    }

    {
        /* Decay falls to the sustain level and holds there while the note is
         * down, rather than continuing to zero. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("decay"), 0.02f);
        vca_set_param(&fx, vca_param_id("sustain"), 0.5f);
        note_on(&fx, 60);
        require_true(fabsf(gain_after(&fx, 0.5f) - 0.5f) < 0.01f, "decays to the sustain level");
        require_true(fabsf(gain_after(&fx, 0.5f) - 0.5f) < 0.01f, "holds sustain while held");
    }

    {
        /* Release arrives in the time it says, for the same reason attack does:
         * the Amp page draws attack and release against one axis by their
         * declared seconds, so a release that only approached silence would be
         * drawn as the shorter of the two while sounding several times longer. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("release"), 0.5f);
        note_on(&fx, 60);
        (void)gain_after(&fx, 0.05f);
        note_off(&fx, 60);
        require_true(gain_after(&fx, 0.25f) > 0.2f, "release is still sounding halfway through");
        require_true(gain_after(&fx, 0.25f) < 0.001f, "release reaches silence by its stated time");
    }

    {
        /* Decay arrives at sustain in the time it says, rather than approaching
         * it for the whole note. */
        vca_core_t fx;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("decay"), 0.5f);
        vca_set_param(&fx, vca_param_id("sustain"), 0.25f);
        note_on(&fx, 60);
        require_true(gain_after(&fx, 0.25f) > 0.4f, "decay is still falling halfway through");
        require_true(fabsf(gain_after(&fx, 0.25f) - 0.25f) < 0.001f,
                     "decay reaches sustain by its stated time");
    }

    {
        /* The first note takes the gain from the pass-through, and over a chain
         * that is sounding it has to take it continuously. Stepping a ringing
         * chain from 1 to 0 in one sample is a click, and a long attack holds it
         * there long enough to hear. */
        vca_core_t fx;
        static float in_l[256], in_r[256], out_l[256], out_r[256];
        int i;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("attack"), 1.2f);
        for (i = 0; i < 256; i++) { in_l[i] = 1.0f; in_r[i] = 1.0f; }
        vca_process_float(&fx, in_l, in_r, out_l, out_r, 256);
        require_true(out_l[255] == 1.0f, "passes the sounding chain through before any note");
        note_on(&fx, 60);
        vca_process_float(&fx, in_l, in_r, out_l, out_r, 256);
        require_true(out_l[0] > 0.9f, "the first note over a sounding chain does not cut it");
    }

    {
        /* Over a chain that was silent there is nothing to cut, so the same
         * first note has to be heard attacking from silence. */
        vca_core_t fx;
        static float in_l[256], in_r[256], out_l[256], out_r[256];
        int i;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("attack"), 0.5f);
        for (i = 0; i < 256; i++) { in_l[i] = 0.0f; in_r[i] = 0.0f; }
        vca_process_float(&fx, in_l, in_r, out_l, out_r, 256);
        note_on(&fx, 60);
        for (i = 0; i < 256; i++) { in_l[i] = 1.0f; in_r[i] = 1.0f; }
        vca_process_float(&fx, in_l, in_r, out_l, out_r, 256);
        require_true(out_l[0] < 0.01f, "the first note over a silent chain attacks from silence");
        require_true(gain_after(&fx, 0.5f) > 0.99f, "and still reaches full at its stated time");
    }

    {
        /* Nothing here may produce a non-finite sample or exceed unity, at any
         * setting, with any note history. */
        vca_core_t fx;
        static float in_l[512], in_r[512], out_l[512], out_r[512];
        int i;
        vca_init(&fx);
        vca_set_param(&fx, vca_param_id("attack"), -1.0f);
        vca_set_param(&fx, vca_param_id("decay"), 99.0f);
        vca_set_param(&fx, vca_param_id("sustain"), 99.0f);
        vca_set_param(&fx, vca_param_id("release"), -1.0f);
        require_true(vca_get_param(&fx, vca_param_id("attack")) >= 0.0f, "attack clamps low");
        require_true(vca_get_param(&fx, vca_param_id("sustain")) <= 1.0f, "sustain clamps high");
        note_on(&fx, 0);
        note_off(&fx, 127);
        for (i = 0; i < 512; i++) { in_l[i] = i % 2 ? 1.0f : -1.0f; in_r[i] = -in_l[i]; }
        vca_process_float(&fx, in_l, in_r, out_l, out_r, 512);
        for (i = 0; i < 512; i++) {
            require_true(isfinite(out_l[i]) && isfinite(out_r[i]), "output is finite");
            require_true(fabsf(out_l[i]) <= 1.0f && fabsf(out_r[i]) <= 1.0f,
                         "output never exceeds its input");
        }
    }

    printf("vca core tests passed\n");
    return 0;
}

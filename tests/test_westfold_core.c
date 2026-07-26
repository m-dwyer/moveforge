#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "westfold_core.h"
#include "westfold_presets.gen.inc"

#define FRAMES 4096
#define TAIL_FRAMES 65536

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static float absf_local(float x) {
    return x < 0.0f ? -x : x;
}

/* Pairwise extremes across the params with feedback or nonlinearity in their
 * path. Single-param stress (scripts/render-stress.ts) misses the combinations
 * that actually destabilise DSP — a resonant filter blows up at high cutoff AND
 * high resonance, not at either alone. Values are set far outside the declared
 * range so the generated clamps in westfold_set_param are exercised too. */
static void test_param_extremes_are_stable(void) {
    static const char *keys[] = {
        "fold", "fm", "ratio", "chaos", "strike",
        "lpg", "drive", "tone", "width", "volume"
    };
    const int n = (int)(sizeof(keys) / sizeof(keys[0]));
    float l[256];
    float r[256];

    for (int a = 0; a < n; a++) {
        for (int b = 0; b < n; b++) {
            for (int va = 0; va <= 1; va++) {
                for (int vb = 0; vb <= 1; vb++) {
                    westfold_core_t s;
                    int ia = westfold_param_id(keys[a]);
                    int ib = westfold_param_id(keys[b]);
                    require_true(ia >= 0 && ib >= 0, "stress param keys exist");

                    westfold_init(&s);
                    westfold_set_param(&s, ia, va ? 1.0e9f : -1.0e9f);
                    westfold_set_param(&s, ib, vb ? 1.0e9f : -1.0e9f);
                    westfold_note_on(&s, 60, 1.0f);

                    for (int block = 0; block < 80; block++) {
                        if (block == 60) westfold_note_off(&s, 60);
                        westfold_process_float(&s, NULL, NULL, l, r, 256);
                        for (int i = 0; i < 256; i++) {
                            if (!isfinite(l[i]) || !isfinite(r[i]) ||
                                absf_local(l[i]) > 1.0f || absf_local(r[i]) > 1.0f) {
                                fprintf(stderr, "FAIL: unstable at %s=%s %s=%s\n",
                                        keys[a], va ? "max" : "min",
                                        keys[b], vb ? "max" : "min");
                                exit(1);
                            }
                        }
                    }
                }
            }
        }
    }
}

int main(void) {
    westfold_core_t synth;
    float left[FRAMES];
    float right[FRAMES];
    float tail_left[TAIL_FRAMES];
    float tail_right[TAIL_FRAMES];
    westfold_init(&synth);

    int volume_id = westfold_param_id("volume");
    int ratio_id = westfold_param_id("ratio");
    int decay_id = westfold_param_id("decay");
    int fold_id = westfold_param_id("fold");
    int snap_id = westfold_param_id("snap");
    int fm_id = westfold_param_id("fm");
    int lpg_id = westfold_param_id("lpg");
    int tone_id = westfold_param_id("tone");
    int drive_id = westfold_param_id("drive");
    int strike_id = westfold_param_id("strike");
    int chaos_id = westfold_param_id("chaos");
    int width_id = westfold_param_id("width");
    int sustain_id = westfold_param_id("sustain");

    require_true(westfold_preset_count() == 12, "preset count is exposed");
    require_true(westfold_preset_name(2)[0] == 'R', "preset name is exposed");
    require_true(westfold_preset_name(11)[0] == 'D', "new preset name is exposed");
    westfold_apply_preset(&synth, 2);
    require_true(westfold_get_param(&synth, volume_id) > 0.79f, "preset applies volume");
    require_true(westfold_get_param(&synth, fold_id) > 0.67f, "preset applies fold");

    westfold_set_param(&synth, volume_id, 2.0f);
    require_true(westfold_get_param(&synth, volume_id) <= 1.0f, "volume clamps high");

    westfold_set_param(&synth, decay_id, -1.0f);
    require_true(westfold_get_param(&synth, decay_id) >= 0.02f, "decay clamps low");

    westfold_set_param(&synth, drive_id, 2.0f);
    westfold_set_param(&synth, snap_id, 2.0f);
    westfold_set_param(&synth, tone_id, -1.0f);
    westfold_set_param(&synth, strike_id, -1.0f);
    westfold_set_param(&synth, chaos_id, 2.0f);
    westfold_set_param(&synth, width_id, 2.0f);
    westfold_set_param(&synth, sustain_id, 2.0f);
    require_true(westfold_get_param(&synth, drive_id) <= 1.0f, "drive clamps high");
    require_true(westfold_get_param(&synth, snap_id) <= 1.0f, "snap clamps high");
    require_true(westfold_get_param(&synth, tone_id) >= 0.0f, "tone clamps low");
    require_true(westfold_get_param(&synth, strike_id) >= 0.0f, "strike clamps low");
    require_true(westfold_get_param(&synth, chaos_id) <= 1.0f, "chaos clamps high");
    require_true(westfold_get_param(&synth, width_id) <= 1.0f, "width clamps high");
    require_true(westfold_get_param(&synth, sustain_id) <= 1.0f, "sustain clamps high");

    westfold_set_param(&synth, volume_id, 0.8f);
    westfold_set_param(&synth, fold_id, 0.6f);
    westfold_set_param(&synth, snap_id, 1.0f);
    westfold_set_param(&synth, tone_id, 0.7f);
    westfold_set_param(&synth, drive_id, 0.45f);
    westfold_set_param(&synth, strike_id, 0.7f);
    westfold_set_param(&synth, chaos_id, 0.35f);
    westfold_set_param(&synth, width_id, 0.6f);
    westfold_set_param(&synth, sustain_id, 0.55f);
    westfold_note_on(&synth, 60, 1.0f);
    westfold_process_float(&synth, NULL, NULL, left, right, FRAMES);

    float peak = 0.0f;
    double energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(left[i]) && isfinite(right[i]), "render output is finite");
        require_true(left[i] <= 1.0f && left[i] >= -1.0f, "left output remains normalized");
        require_true(right[i] <= 1.0f && right[i] >= -1.0f, "right output remains normalized");
        float a = absf_local(left[i]);
        if (a > peak) peak = a;
        energy += (double)left[i] * (double)left[i];
    }
    require_true(peak > 0.001f, "note-on render is not silent");
    require_true(energy > 0.01, "note-on render has energy");

    double stereo_diff = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        stereo_diff += (double)absf_local(left[i] - right[i]);
    }
    require_true(stereo_diff > 0.001, "width creates a measurable stereo difference");

    westfold_set_param(&synth, volume_id, 0.0f);
    westfold_process_float(&synth, NULL, NULL, left, right, FRAMES);
    float muted_peak = 0.0f;
    double muted_energy = 0.0;
    for (int i = FRAMES - 512; i < FRAMES; i++) {
        require_true(isfinite(left[i]) && isfinite(right[i]), "muted output is finite");
        float l = absf_local(left[i]);
        float r = absf_local(right[i]);
        if (l > muted_peak) muted_peak = l;
        if (r > muted_peak) muted_peak = r;
        muted_energy += (double)left[i] * (double)left[i] + (double)right[i] * (double)right[i];
    }
    require_true(muted_peak < 0.0001f, "volume zero mutes held note output");
    require_true(muted_energy < 0.000001, "volume zero removes held note energy");

    westfold_set_param(&synth, volume_id, 0.8f);
    westfold_process_float(&synth, NULL, NULL, left, right, FRAMES);

    for (int block = 0; block < 16; block++) {
        float hot = (block & 1) ? 1.0f : 0.0f;
        westfold_set_param(&synth, volume_id, hot ? 1.0f : 0.35f);
        westfold_set_param(&synth, ratio_id, hot ? 4.0f : 0.25f);
        westfold_set_param(&synth, fm_id, hot);
        westfold_set_param(&synth, fold_id, hot);
        westfold_set_param(&synth, lpg_id, hot);
        westfold_set_param(&synth, tone_id, hot);
        westfold_set_param(&synth, drive_id, hot);
        westfold_set_param(&synth, chaos_id, hot);
        westfold_set_param(&synth, width_id, hot);
        westfold_process_float(&synth, NULL, NULL, left + block * 256, right + block * 256, 256);
    }

    float automation_peak = 0.0f;
    double automation_energy = 0.0;
    for (int i = 0; i < FRAMES; i++) {
        require_true(isfinite(left[i]) && isfinite(right[i]), "automation output is finite");
        require_true(left[i] <= 1.0f && left[i] >= -1.0f, "automation left output remains normalized");
        require_true(right[i] <= 1.0f && right[i] >= -1.0f, "automation right output remains normalized");
        float l = absf_local(left[i]);
        float r = absf_local(right[i]);
        if (l > automation_peak) automation_peak = l;
        if (r > automation_peak) automation_peak = r;
        automation_energy += (double)left[i] * (double)left[i] + (double)right[i] * (double)right[i];
    }
    require_true(automation_peak > 0.001f, "automation render is not silent");
    require_true(automation_energy > 0.01, "automation render has energy");

    westfold_process_float(&synth, NULL, NULL, tail_left, tail_right, TAIL_FRAMES);
    float held_peak = 0.0f;
    for (int i = TAIL_FRAMES - 4096; i < TAIL_FRAMES; i++) {
        float l = absf_local(tail_left[i]);
        if (l > held_peak) held_peak = l;
    }
    require_true(held_peak > 0.001f, "held note sustains before note off");

    westfold_note_off(&synth, 60);
    float before = synth.env;
    westfold_process_float(&synth, NULL, NULL, left, right, FRAMES);
    require_true(synth.env < before, "release envelope decays after note off");

    westfold_process_float(&synth, NULL, NULL, tail_left, tail_right, TAIL_FRAMES);
    float tail_peak_l = 0.0f;
    float tail_peak_r = 0.0f;
    for (int i = TAIL_FRAMES - 4096; i < TAIL_FRAMES; i++) {
        float l = absf_local(tail_left[i]);
        float r = absf_local(tail_right[i]);
        if (l > tail_peak_l) tail_peak_l = l;
        if (r > tail_peak_r) tail_peak_r = r;
    }
    require_true(tail_peak_l < 0.001f, "left release tail reaches silence");
    require_true(tail_peak_r < 0.001f, "right release tail reaches silence");

    require_true(westfold_param_id("fold") >= 0, "param lookup works");
    require_true(westfold_param_id("chaos") >= 0, "new param lookup works");
    require_true(westfold_param_id("tone") >= 0, "tone param lookup works");
    require_true(westfold_param_id("width") >= 0, "width param lookup works");
    require_true(westfold_param_id("does_not_exist") < 0, "unknown param lookup fails");

    test_param_extremes_are_stable();

    printf("westfold core tests passed\n");
    return 0;
}

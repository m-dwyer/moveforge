#include "trail_core.h"
#include "host/faust_adapter.h"
#include "modules/_shared/dsp_runtime.h"

#include <string.h>

/* Pull the generated Faust C in-line so the moveforge build pipeline sees one
 * translation unit per module. The generated file defines the trail_faust
 * struct and `new`, `init`, `delete`, `compute`, `buildUserInterface`. */
#include "trail_faust.c"

#include "trail_params.gen.inc"

/* Beats of delay per "sync" division index. Index 0 (Free) is unused — Free
 * mode uses the "time" knob instead. 4/4 assumed: a 1/4 note = 1 beat. */
static const double TRAIL_DIV_BEATS[10] = {
    0.0,        /* 0: Free (handled separately) */
    0.25,       /* 1: 1/16 */
    1.0 / 3.0,  /* 2: 1/8 triplet */
    0.5,        /* 3: 1/8 */
    0.75,       /* 4: 1/8 dotted */
    1.0,        /* 5: 1/4 */
    1.5,        /* 6: 1/4 dotted */
    2.0,        /* 7: 1/2 */
    3.0,        /* 8: 3/4 (dotted 1/2) */
    4.0         /* 9: 1/1 bar */
};

static void capture_slider(void *ui, const char *label, FAUSTFLOAT *zone,
                           FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) {
    (void)init; (void)min; (void)max; (void)step;
    trail_core_t *core = (trail_core_t*)ui;
    if (strcmp(label, "_dtime") == 0) {
        core->dtime_zone = (void*)zone;
        return;
    }
    int id = trail_param_id(label);
    if (id >= 0 && id < TRAIL_NUM_PARAMS) core->zones[id] = (void*)zone;
}

/* Push the 1:1 param fields into their captured Faust zones. time/sync have no
 * zone (NULL) and are handled by compute_dtime instead. */
static void push_params_to_faust(trail_core_t *s) {
    float vals[TRAIL_NUM_PARAMS] = {
        s->time, s->sync, s->feedback, s->tone,
        s->mod, s->width, s->drive, s->space, s->mix
    };
    for (int i = 0; i < TRAIL_NUM_PARAMS; i++) {
        FAUSTFLOAT *zone = (FAUSTFLOAT*)s->zones[i];
        if (zone) *zone = (FAUSTFLOAT)vals[i];
    }
}

/* Derive the delay length in samples from time/sync/bpm and write it to the
 * internal Faust "_dtime" zone. Kept here (not in the wrapper) so a direct
 * caller of trail_process_float — e.g. the core test — gets correct timing. */
static void compute_dtime(trail_core_t *s) {
    if (!s->dtime_zone) return;
    float bpm = s->bpm > 0.0f ? s->bpm : 120.0f;
    int sync = (int)(s->sync + 0.5f);

    float dtime;
    if (sync <= 0) {
        /* Free: time 0..1 -> 10 ms .. 2000 ms. */
        float ms = 10.0f + s->time * 1990.0f;
        dtime = ms * 0.001f * MOVEFORGE_SAMPLE_RATE;
    } else {
        if (sync > 9) sync = 9;
        double sec = (60.0 / (double)bpm) * TRAIL_DIV_BEATS[sync];
        dtime = (float)(sec * (double)MOVEFORGE_SAMPLE_RATE);
    }

    dtime = moveforge_clampf(dtime, 64.0f, (float)(TRAIL_MAXDELAY - 8));
    *(FAUSTFLOAT*)s->dtime_zone = (FAUSTFLOAT)dtime;
}

void trail_init(trail_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    trail_apply_defaults(s);
    s->bpm = 120.0f;
    s->clock_running = 0;

    s->fdsp = newtrail_faust();
    if (!s->fdsp) return;
    inittrail_faust((trail_faust*)s->fdsp, (int)MOVEFORGE_SAMPLE_RATE);

    UIGlue glue = moveforge_faust_make_ui(s, capture_slider);
    buildUserInterfacetrail_faust((trail_faust*)s->fdsp, &glue);

    push_params_to_faust(s);
    compute_dtime(s);
}

void trail_destroy(trail_core_t *s) {
    if (!s) return;
    if (s->fdsp) {
        deletetrail_faust((trail_faust*)s->fdsp);
        s->fdsp = NULL;
    }
}

void trail_set_tempo(trail_core_t *s, float bpm, int clock_running) {
    if (!s) return;
    s->bpm = bpm > 0.0f ? bpm : 120.0f;
    s->clock_running = clock_running;
}

void trail_process_float(trail_core_t *s,
                         const float *in_left, const float *in_right,
                         float *out_left, float *out_right,
                         int frames) {
    if (!s || !s->fdsp || !in_left || !in_right || !out_left || !out_right) return;
    push_params_to_faust(s);
    compute_dtime(s);

    FAUSTFLOAT *inputs[2]  = { (FAUSTFLOAT*)in_left, (FAUSTFLOAT*)in_right };
    FAUSTFLOAT *outputs[2] = { out_left, out_right };
    computetrail_faust((trail_faust*)s->fdsp, frames, inputs, outputs);
}

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/audio_fx_api_v2.h"
#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/scope.h"
#include "filter_core.h"
#include "filter_presets.gen.inc"
/* Output-waveform scope: style/mode/window are the single source of truth in
 * capabilities.scope (module.json); set style to "none" there to disable.
 * GENERATED -- re-run gen-params after editing the scope block. */
#include "filter_scope.gen.inc"

typedef struct {
    filter_core_t core;
    int current_preset;
    float in_l[MOVEFORGE_BLOCK_FRAMES];
    float in_r[MOVEFORGE_BLOCK_FRAMES];
    float out_l[MOVEFORGE_BLOCK_FRAMES];
    float out_r[MOVEFORGE_BLOCK_FRAMES];
    mf_scope_t scope;
} filter_plugin_t;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    filter_plugin_t *p = (filter_plugin_t*)calloc(1, sizeof(filter_plugin_t));
    if (p) {
        filter_init(&p->core);
        /* Deliberately no preset at create: filter_init has applied
         * module.json's defaults, and preset selection is the host's
         * (chain_patch.c:1345 sends set_param("preset")). -1 = none selected,
         * so any first pick applies. */
        p->current_preset = -1;
        mf_scope_init(&p->scope, FILTER_SCOPE_WINDOW, FILTER_SCOPE_MODE, FILTER_SCOPE_STYLE);
    }
    return p;
}

static void destroy_instance(void *instance) {
    filter_plugin_t *p = (filter_plugin_t*)instance;
    if (p) filter_destroy(&p->core);
    free(p);
}

static void process_block(void *instance, int16_t *audio_inout, int frames) {
    filter_plugin_t *p = (filter_plugin_t*)instance;
    if (!p || !audio_inout || frames <= 0) return;
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;

    moveforge_stereo_i16_to_float(audio_inout, p->in_l, p->in_r, frames);
    filter_process_float(&p->core, p->in_l, p->in_r, p->out_l, p->out_r, frames);
    mf_scope_capture(&p->scope, p->out_l, p->out_r, frames);
    moveforge_stereo_float_to_i16(p->out_l, p->out_r, audio_inout, frames);
}

static void set_param(void *instance, const char *key, const char *val) {
    filter_plugin_t *p = (filter_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "preset") == 0) {
        /* Idempotent on purpose. The host enrols "preset" in its audio-thread
         * smoother — is_smoothable_float("0") and ("1") both return 1, and
         * "preset" is not a module.json param so there is no type info to
         * exclude it — then re-sends every enrolled key whenever any one of
         * them moves. Applying it unconditionally therefore reset every
         * parameter on each detent of an unrelated encoder. */
        int next = filter_clamp_preset_index(atoi(val));
        if (next == p->current_preset) return;
        p->current_preset = next;
        filter_apply_preset(&p->core, p->current_preset);
        return;
    }
    filter_set_param(&p->core, filter_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    filter_plugin_t *p = (filter_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    if (strcmp(key, "preset_count") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", filter_preset_count());
    }
    if (strcmp(key, "preset") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", p->current_preset);
    }
    if (strcmp(key, "preset_name") == 0) {
        return snprintf(buf, (size_t)buf_len, "%s", filter_preset_name(p->current_preset));
    }
    if (strcmp(key, "__scope") == 0) {
        return mf_scope_serialize(&p->scope, buf, buf_len);
    }
    int id = filter_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", filter_get_param(&p->core, id));
}

/* No on_midi: it is optional in audio_fx_api_v2, and a filter is not played by
 * notes. An empty stub tells a host that checks the pointer the opposite. */
static audio_fx_api_v2_t g_api = {
    .api_version = AUDIO_FX_API_VERSION_2,
    .create_instance = create_instance,
    .destroy_instance = destroy_instance,
    .process_block = process_block,
    .set_param = set_param,
    .get_param = get_param
};

audio_fx_api_v2_t* move_audio_fx_init_v2(const host_api_v1_t *host) {
    (void)host;
    return &g_api;
}

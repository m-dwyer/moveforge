#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/midi_fx_api_v1.h"
#include "arpy_core.h"
#include "arpy_presets.gen.inc"

typedef struct {
    arpy_core_t core;
    int current_preset;
} arpy_plugin_t;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    arpy_plugin_t *p = (arpy_plugin_t*)calloc(1, sizeof(arpy_plugin_t));
    if (p) {
        arpy_init(&p->core);
        /* Deliberately no preset at create: arpy_init has applied module.json's
         * defaults, and preset selection is the host's (chain_patch.c:1345 sends
         * set_param("preset")). -1 = none selected, so any first pick applies. */
        p->current_preset = -1;
    }
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static int process_midi(void *instance,
                        const uint8_t *in_msg, int in_len,
                        uint8_t out_msgs[][3], int out_lens[], int max_out) {
    arpy_plugin_t *p = (arpy_plugin_t*)instance;
    if (!p) return 0;
    return arpy_process_midi(&p->core, in_msg, in_len, out_msgs, out_lens, max_out);
}

static int tick(void *instance,
                int frames, int sample_rate,
                uint8_t out_msgs[][3], int out_lens[], int max_out) {
    arpy_plugin_t *p = (arpy_plugin_t*)instance;
    if (!p) return 0;
    return arpy_tick(&p->core, frames, sample_rate, out_msgs, out_lens, max_out);
}

static void set_param(void *instance, const char *key, const char *val) {
    arpy_plugin_t *p = (arpy_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "preset") == 0) {
        /* Idempotent on purpose — see the note in westfold.c. */
        int next = arpy_clamp_preset_index(atoi(val));
        if (next == p->current_preset) return;
        p->current_preset = next;
        arpy_apply_preset(&p->core, p->current_preset);
        return;
    }
    arpy_set_param(&p->core, arpy_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    arpy_plugin_t *p = (arpy_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    if (strcmp(key, "preset_count") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", arpy_preset_count());
    }
    if (strcmp(key, "preset") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", p->current_preset);
    }
    if (strcmp(key, "preset_name") == 0) {
        return snprintf(buf, (size_t)buf_len, "%s", arpy_preset_name(p->current_preset));
    }
    int id = arpy_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", arpy_get_param(&p->core, id));
}

static midi_fx_api_v1_t g_api = {
    .api_version = MOVE_MIDI_FX_API_VERSION,
    .create_instance = create_instance,
    .destroy_instance = destroy_instance,
    .process_midi = process_midi,
    .tick = tick,
    .set_param = set_param,
    .get_param = get_param
};

midi_fx_api_v1_t* move_midi_fx_init(const host_api_v1_t *host) {
    (void)host;
    return &g_api;
}

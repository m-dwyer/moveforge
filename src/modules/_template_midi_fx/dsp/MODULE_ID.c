#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "host/midi_fx_api_v1.h"
#include "MODULE_ID_core.h"

typedef struct {
    MODULE_ID_core_t core;
} MODULE_ID_plugin_t;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    MODULE_ID_plugin_t *p = (MODULE_ID_plugin_t*)calloc(1, sizeof(MODULE_ID_plugin_t));
    if (p) MODULE_ID_init(&p->core);
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static int process_midi(void *instance,
                        const uint8_t *in_msg, int in_len,
                        uint8_t out_msgs[][3], int out_lens[], int max_out) {
    MODULE_ID_plugin_t *p = (MODULE_ID_plugin_t*)instance;
    if (!p) return 0;
    return MODULE_ID_process_midi(&p->core, in_msg, in_len, out_msgs, out_lens, max_out);
}

static int tick(void *instance,
                int frames, int sample_rate,
                uint8_t out_msgs[][3], int out_lens[], int max_out) {
    MODULE_ID_plugin_t *p = (MODULE_ID_plugin_t*)instance;
    if (!p) return 0;
    return MODULE_ID_tick(&p->core, frames, sample_rate, out_msgs, out_lens, max_out);
}

static void set_param(void *instance, const char *key, const char *val) {
    MODULE_ID_plugin_t *p = (MODULE_ID_plugin_t*)instance;
    if (p && key && val) MODULE_ID_set_param(&p->core, MODULE_ID_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    MODULE_ID_plugin_t *p = (MODULE_ID_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    int id = MODULE_ID_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", MODULE_ID_get_param(&p->core, id));
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

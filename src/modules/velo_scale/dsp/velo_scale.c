#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "host/midi_fx_api_v1.h"
#include "velo_scale_core.h"

typedef struct {
    velo_scale_core_t core;
} velo_scale_plugin_t;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    velo_scale_plugin_t *p = (velo_scale_plugin_t*)calloc(1, sizeof(velo_scale_plugin_t));
    if (p) velo_scale_init(&p->core);
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static int process_midi(void *instance,
                        const uint8_t *in_msg, int in_len,
                        uint8_t out_msgs[][3], int out_lens[], int max_out) {
    velo_scale_plugin_t *p = (velo_scale_plugin_t*)instance;
    if (!p) return 0;
    return velo_scale_process_midi(&p->core, in_msg, in_len, out_msgs, out_lens, max_out);
}

static int tick(void *instance,
                int frames, int sample_rate,
                uint8_t out_msgs[][3], int out_lens[], int max_out) {
    velo_scale_plugin_t *p = (velo_scale_plugin_t*)instance;
    if (!p) return 0;
    return velo_scale_tick(&p->core, frames, sample_rate, out_msgs, out_lens, max_out);
}

static void set_param(void *instance, const char *key, const char *val) {
    velo_scale_plugin_t *p = (velo_scale_plugin_t*)instance;
    if (p && key && val) velo_scale_set_param(&p->core, velo_scale_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    velo_scale_plugin_t *p = (velo_scale_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    int id = velo_scale_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", velo_scale_get_param(&p->core, id));
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

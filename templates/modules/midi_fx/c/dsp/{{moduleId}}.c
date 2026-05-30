#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/midi_fx_api_v1.h"
#include "{{moduleId}}_core.h"
#include "{{moduleId}}_presets.gen.inc"

typedef struct {
    {{moduleId}}_core_t core;
    int current_preset;
} {{moduleId}}_plugin_t;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)calloc(1, sizeof({{moduleId}}_plugin_t));
    if (p) {
        {{moduleId}}_init(&p->core);
        p->current_preset = {{moduleId}}_clamp_preset_index(0);
        {{moduleId}}_apply_preset(&p->core, p->current_preset);
    }
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static int process_midi(void *instance,
                        const uint8_t *in_msg, int in_len,
                        uint8_t out_msgs[][3], int out_lens[], int max_out) {
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p) return 0;
    return {{moduleId}}_process_midi(&p->core, in_msg, in_len, out_msgs, out_lens, max_out);
}

static int tick(void *instance,
                int frames, int sample_rate,
                uint8_t out_msgs[][3], int out_lens[], int max_out) {
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p) return 0;
    return {{moduleId}}_tick(&p->core, frames, sample_rate, out_msgs, out_lens, max_out);
}

static void set_param(void *instance, const char *key, const char *val) {
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "preset") == 0) {
        p->current_preset = {{moduleId}}_clamp_preset_index(atoi(val));
        {{moduleId}}_apply_preset(&p->core, p->current_preset);
        return;
    }
    {{moduleId}}_set_param(&p->core, {{moduleId}}_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    if (strcmp(key, "preset_count") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", {{moduleId}}_preset_count());
    }
    if (strcmp(key, "preset") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", p->current_preset);
    }
    if (strcmp(key, "preset_name") == 0) {
        return snprintf(buf, (size_t)buf_len, "%s", {{moduleId}}_preset_name(p->current_preset));
    }
    int id = {{moduleId}}_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", {{moduleId}}_get_param(&p->core, id));
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

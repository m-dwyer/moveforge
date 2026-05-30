#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/audio_fx_api_v2.h"
#include "modules/_shared/dsp_runtime.h"
#include "{{moduleId}}_core.h"
#include "{{moduleId}}_presets.gen.inc"

typedef struct {
    {{moduleId}}_core_t core;
    int current_preset;
    float in_l[MOVEFORGE_BLOCK_FRAMES];
    float in_r[MOVEFORGE_BLOCK_FRAMES];
    float out_l[MOVEFORGE_BLOCK_FRAMES];
    float out_r[MOVEFORGE_BLOCK_FRAMES];
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

static void process_block(void *instance, int16_t *audio_inout, int frames) {
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p || !audio_inout || frames <= 0) return;
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;

    moveforge_stereo_i16_to_float(audio_inout, p->in_l, p->in_r, frames);
    {{moduleId}}_process_float(&p->core, p->in_l, p->in_r, p->out_l, p->out_r, frames);
    moveforge_stereo_float_to_i16(p->out_l, p->out_r, audio_inout, frames);
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

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)instance;
    (void)msg;
    (void)len;
    (void)source;
}

static audio_fx_api_v2_t g_api = {
    .api_version = AUDIO_FX_API_VERSION_2,
    .create_instance = create_instance,
    .destroy_instance = destroy_instance,
    .process_block = process_block,
    .set_param = set_param,
    .get_param = get_param,
    .on_midi = on_midi
};

audio_fx_api_v2_t* move_audio_fx_init_v2(const host_api_v1_t *host) {
    (void)host;
    return &g_api;
}

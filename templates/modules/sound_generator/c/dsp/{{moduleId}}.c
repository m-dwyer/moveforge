#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"
#include "modules/_shared/dsp_runtime.h"
#include "{{moduleId}}_core.h"
#include "{{moduleId}}_presets.gen.inc"

typedef struct {
    {{moduleId}}_core_t core;
    int current_preset;
} {{moduleId}}_plugin_t;

static const host_api_v1_t *g_host = NULL;

static void* create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir;
    (void)json_defaults;
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)calloc(1, sizeof({{moduleId}}_plugin_t));
    if (!p) return NULL;
    {{moduleId}}_init(&p->core);
    p->current_preset = {{moduleId}}_clamp_preset_index(0);
    {{moduleId}}_apply_preset(&p->core, p->current_preset);
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)source;
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p || len < 3) return;
    uint8_t status = msg[0] & 0xF0;
    if (status == 0x90 && msg[2] > 0) {
        {{moduleId}}_note_on(&p->core, msg[1], (float)msg[2] / 127.0f);
    } else if (status == 0x80 || (status == 0x90 && msg[2] == 0)) {
        {{moduleId}}_note_off(&p->core, msg[1]);
    } else if (status == 0xE0) {
        {{moduleId}}_pitch_bend(&p->core, moveforge_midi_bend_normalized(msg[1], msg[2]));
    }
}

static void set_param(void *instance, const char *key, const char *val) {
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "all_notes_off") == 0) {
        {{moduleId}}_all_notes_off(&p->core);
        return;
    }
    if (strcmp(key, "preset") == 0) {
        p->current_preset = {{moduleId}}_clamp_preset_index(atoi(val));
        {{moduleId}}_all_notes_off(&p->core);
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
    int param_id = {{moduleId}}_param_id(key);
    if (param_id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", {{moduleId}}_get_param(&p->core, param_id));
}

static int get_error(void *instance, char *buf, int buf_len) {
    (void)instance;
    if (buf && buf_len > 0) buf[0] = '\0';
    return 0;
}

static void render_block(void *instance, int16_t *out, int frames) {
    {{moduleId}}_plugin_t *p = ({{moduleId}}_plugin_t*)instance;
    if (!p || !out || frames <= 0) return;

    float left[MOVEFORGE_BLOCK_FRAMES];
    float right[MOVEFORGE_BLOCK_FRAMES];
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;
    {{moduleId}}_process_float(&p->core, NULL, NULL, left, right, frames);
    moveforge_stereo_float_to_i16(left, right, out, frames);
}

static plugin_api_v2_t g_api = {
    .api_version = MOVE_PLUGIN_API_VERSION_2,
    .create_instance = create_instance,
    .destroy_instance = destroy_instance,
    .on_midi = on_midi,
    .set_param = set_param,
    .get_param = get_param,
    .get_error = get_error,
    .render_block = render_block
};

plugin_api_v2_t* move_plugin_init_v2(const host_api_v1_t *host) {
    g_host = host;
    if (g_host && g_host->log) g_host->log("[{{moduleId}}] init v2");
    return &g_api;
}

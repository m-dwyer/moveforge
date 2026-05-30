#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"
#include "modules/_shared/dsp_runtime.h"
#include "westfold_core.h"
#include "westfold_presets.gen.inc"

typedef struct {
    westfold_core_t core;
    int current_preset;
} westfold_plugin_t;

static const host_api_v1_t *g_host = NULL;

static void* create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir;
    (void)json_defaults;
    westfold_plugin_t *p = (westfold_plugin_t*)calloc(1, sizeof(westfold_plugin_t));
    if (!p) return NULL;
    westfold_init(&p->core);
    p->current_preset = westfold_clamp_preset_index(0);
    westfold_apply_preset(&p->core, p->current_preset);
    return p;
}

static void destroy_instance(void *instance) {
    free(instance);
}

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)source;
    westfold_plugin_t *p = (westfold_plugin_t*)instance;
    if (!p || len < 3) return;

    uint8_t status = msg[0] & 0xF0;
    if (status == 0x90 && msg[2] > 0) {
        westfold_note_on(&p->core, msg[1], (float)msg[2] / 127.0f);
    } else if (status == 0x80 || (status == 0x90 && msg[2] == 0)) {
        westfold_note_off(&p->core, msg[1]);
    } else if (status == 0xE0) {
        westfold_pitch_bend(&p->core, moveforge_midi_bend_normalized(msg[1], msg[2]));
    }
}

static void set_param(void *instance, const char *key, const char *val) {
    westfold_plugin_t *p = (westfold_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "all_notes_off") == 0) {
        westfold_all_notes_off(&p->core);
        return;
    }
    if (strcmp(key, "preset") == 0) {
        p->current_preset = westfold_clamp_preset_index(atoi(val));
        westfold_all_notes_off(&p->core);
        westfold_apply_preset(&p->core, p->current_preset);
        return;
    }
    westfold_set_param(&p->core, westfold_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    westfold_plugin_t *p = (westfold_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    if (strcmp(key, "preset_count") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", westfold_preset_count());
    }
    if (strcmp(key, "preset") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", p->current_preset);
    }
    if (strcmp(key, "preset_name") == 0) {
        return snprintf(buf, (size_t)buf_len, "%s", westfold_preset_name(p->current_preset));
    }
    int param_id = westfold_param_id(key);
    if (param_id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", westfold_get_param(&p->core, param_id));
}

static int get_error(void *instance, char *buf, int buf_len) {
    (void)instance;
    if (buf && buf_len > 0) buf[0] = '\0';
    return 0;
}

static void render_block(void *instance, int16_t *out, int frames) {
    westfold_plugin_t *p = (westfold_plugin_t*)instance;
    if (!p || !out || frames <= 0) return;

    float left[MOVEFORGE_BLOCK_FRAMES];
    float right[MOVEFORGE_BLOCK_FRAMES];
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;
    westfold_process_float(&p->core, NULL, NULL, left, right, frames);
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
    if (g_host && g_host->log) g_host->log("[westfold] init v2");
    return &g_api;
}

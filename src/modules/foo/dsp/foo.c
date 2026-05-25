#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"
#include "foo_core.h"

typedef struct {
    foo_core_t core;
} foo_plugin_t;

static const host_api_v1_t *g_host = NULL;

static void* create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir;
    (void)json_defaults;
    foo_plugin_t *p = (foo_plugin_t*)calloc(1, sizeof(foo_plugin_t));
    if (!p) return NULL;
    foo_init(&p->core);
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)source;
    foo_plugin_t *p = (foo_plugin_t*)instance;
    if (!p || len < 3) return;
    uint8_t status = msg[0] & 0xF0;
    if (status == 0x90 && msg[2] > 0) {
        foo_note_on(&p->core, msg[1], (float)msg[2] / 127.0f);
    } else if (status == 0x80 || (status == 0x90 && msg[2] == 0)) {
        foo_note_off(&p->core, msg[1]);
    } else if (status == 0xE0) {
        int bend = ((int)msg[2] << 7) | msg[1];
        foo_pitch_bend(&p->core, ((float)bend - 8192.0f) / 8192.0f);
    }
}

static void set_param(void *instance, const char *key, const char *val) {
    foo_plugin_t *p = (foo_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "all_notes_off") == 0) {
        foo_all_notes_off(&p->core);
        return;
    }
    foo_set_param(&p->core, foo_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    foo_plugin_t *p = (foo_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    int param_id = foo_param_id(key);
    if (param_id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", foo_get_param(&p->core, param_id));
}

static int get_error(void *instance, char *buf, int buf_len) {
    (void)instance;
    if (buf && buf_len > 0) buf[0] = '\0';
    return 0;
}

static void render_block(void *instance, int16_t *out, int frames) {
    foo_plugin_t *p = (foo_plugin_t*)instance;
    if (!p || !out || frames <= 0) return;

    float left[128];
    float right[128];
    if (frames > 128) frames = 128;
    foo_process_float(&p->core, NULL, NULL, left, right, frames);

    for (int i = 0; i < frames; i++) {
        float l = left[i] * 32767.0f;
        float r = right[i] * 32767.0f;
        if (l > 32767.0f) l = 32767.0f;
        if (l < -32768.0f) l = -32768.0f;
        if (r > 32767.0f) r = 32767.0f;
        if (r < -32768.0f) r = -32768.0f;
        out[i * 2] = (int16_t)l;
        out[i * 2 + 1] = (int16_t)r;
    }
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
    if (g_host && g_host->log) g_host->log("[foo] init v2");
    return &g_api;
}

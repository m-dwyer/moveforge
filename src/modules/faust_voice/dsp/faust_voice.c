#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"
#include "modules/_shared/dsp_runtime.h"
#include "faust_voice_core.h"

typedef struct {
    faust_voice_core_t core;
} faust_voice_plugin_t;

static const host_api_v1_t *g_host = NULL;

static void* create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir;
    (void)json_defaults;
    faust_voice_plugin_t *p = (faust_voice_plugin_t*)calloc(1, sizeof(faust_voice_plugin_t));
    if (!p) return NULL;
    faust_voice_init(&p->core);
    return p;
}

static void destroy_instance(void *instance) {
    faust_voice_plugin_t *p = (faust_voice_plugin_t*)instance;
    if (p) faust_voice_destroy(&p->core);
    free(p);
}

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)source;
    faust_voice_plugin_t *p = (faust_voice_plugin_t*)instance;
    if (!p || len < 3) return;

    uint8_t status = msg[0] & 0xF0;
    if (status == 0x90 && msg[2] > 0) {
        faust_voice_note_on(&p->core, msg[1], (float)msg[2] / 127.0f);
    } else if (status == 0x80 || (status == 0x90 && msg[2] == 0)) {
        faust_voice_note_off(&p->core, msg[1]);
    } else if (status == 0xE0) {
        faust_voice_pitch_bend(&p->core, moveforge_midi_bend_normalized(msg[1], msg[2]));
    }
}

static void set_param(void *instance, const char *key, const char *val) {
    faust_voice_plugin_t *p = (faust_voice_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "all_notes_off") == 0) {
        faust_voice_all_notes_off(&p->core);
        return;
    }
    faust_voice_set_param(&p->core, faust_voice_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    faust_voice_plugin_t *p = (faust_voice_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    int param_id = faust_voice_param_id(key);
    if (param_id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", faust_voice_get_param(&p->core, param_id));
}

static int get_error(void *instance, char *buf, int buf_len) {
    (void)instance;
    if (buf && buf_len > 0) buf[0] = '\0';
    return 0;
}

static void render_block(void *instance, int16_t *out, int frames) {
    faust_voice_plugin_t *p = (faust_voice_plugin_t*)instance;
    if (!p || !out || frames <= 0) return;

    float left[MOVEFORGE_BLOCK_FRAMES];
    float right[MOVEFORGE_BLOCK_FRAMES];
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;
    faust_voice_process_float(&p->core, NULL, NULL, left, right, frames);
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
    if (g_host && g_host->log) g_host->log("[faust_voice] init v2");
    return &g_api;
}

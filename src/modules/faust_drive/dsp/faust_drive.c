#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "host/audio_fx_api_v2.h"
#include "modules/_shared/dsp_runtime.h"
#include "faust_drive_core.h"

typedef struct {
    faust_drive_core_t core;
    float in_l[MOVEFORGE_BLOCK_FRAMES];
    float in_r[MOVEFORGE_BLOCK_FRAMES];
    float out_l[MOVEFORGE_BLOCK_FRAMES];
    float out_r[MOVEFORGE_BLOCK_FRAMES];
} faust_drive_plugin_t;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    faust_drive_plugin_t *p = (faust_drive_plugin_t*)calloc(1, sizeof(faust_drive_plugin_t));
    if (p) faust_drive_init(&p->core);
    return p;
}

static void destroy_instance(void *instance) {
    faust_drive_plugin_t *p = (faust_drive_plugin_t*)instance;
    if (p) faust_drive_destroy(&p->core);
    free(p);
}

static void process_block(void *instance, int16_t *audio_inout, int frames) {
    faust_drive_plugin_t *p = (faust_drive_plugin_t*)instance;
    if (!p || !audio_inout || frames <= 0) return;
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;

    moveforge_stereo_i16_to_float(audio_inout, p->in_l, p->in_r, frames);
    faust_drive_process_float(&p->core, p->in_l, p->in_r, p->out_l, p->out_r, frames);
    moveforge_stereo_float_to_i16(p->out_l, p->out_r, audio_inout, frames);
}

static void set_param(void *instance, const char *key, const char *val) {
    faust_drive_plugin_t *p = (faust_drive_plugin_t*)instance;
    if (p && key && val) faust_drive_set_param(&p->core, faust_drive_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    faust_drive_plugin_t *p = (faust_drive_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    int id = faust_drive_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", faust_drive_get_param(&p->core, id));
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

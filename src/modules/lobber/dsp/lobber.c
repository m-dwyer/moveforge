#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/audio_fx_api_v2.h"
#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/scope.h"
#include "lobber_core.h"
#include "lobber_presets.gen.inc"
/* Output-waveform scope: style/mode/window are the single source of truth in
 * capabilities.scope (module.json); set style to "none" there to disable.
 * GENERATED -- re-run gen-params after editing the scope block. */
#include "lobber_scope.gen.inc"

typedef struct {
    lobber_core_t core;
    int current_preset;
    float in_l[MOVEFORGE_BLOCK_FRAMES];
    float in_r[MOVEFORGE_BLOCK_FRAMES];
    float out_l[MOVEFORGE_BLOCK_FRAMES];
    float out_r[MOVEFORGE_BLOCK_FRAMES];
    mf_scope_t scope;
} lobber_plugin_t;

/* Host API captured at module init; used to read Move's tempo/clock for sync.
 * Module-level — the host pointer is shared across instances. */
static const host_api_v1_t *g_host = NULL;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    /* malloc, not calloc: lobber_init memsets the whole struct anyway, and the
     * embedded ring plus loop buffers are 8 MB — zeroing them twice is 16 MB of
     * writes. create_instance runs on the SPI thread on device (schwung's
     * REALTIME_SAFETY.md accepts the load hiccup), so halving it is free. */
    lobber_plugin_t *p = (lobber_plugin_t*)malloc(sizeof(lobber_plugin_t));
    if (p) {
        lobber_init(&p->core);
        p->current_preset = lobber_clamp_preset_index(0);
        lobber_apply_preset(&p->core, p->current_preset);
        mf_scope_init(&p->scope, LOBBER_SCOPE_WINDOW, LOBBER_SCOPE_MODE, LOBBER_SCOPE_STYLE);
    }
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static void process_block(void *instance, int16_t *audio_inout, int frames) {
    lobber_plugin_t *p = (lobber_plugin_t*)instance;
    if (!p || !audio_inout || frames <= 0) return;
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;

    /* Sync to host tempo when the clock is available (device); otherwise the
     * core falls back to its bpm param (offline renderer, browser). */
    float bpm = 120.0f;
    int clock_available = 0;
    int status = MOVE_CLOCK_STATUS_UNAVAILABLE;
    if (g_host) {
        status = g_host->get_clock_status ? g_host->get_clock_status()
                                          : MOVE_CLOCK_STATUS_UNAVAILABLE;
        clock_available = (status != MOVE_CLOCK_STATUS_UNAVAILABLE);
        if (clock_available && g_host->get_bpm) {
            float b = g_host->get_bpm();
            if (b > 0.0f) bpm = b;
        }
    }
    lobber_set_tempo(&p->core, bpm, clock_available);
    /* Loop mode mutes when the host transport is stopped; treat "no clock"
     * (offline renderer, browser) as running so audition/render still play. */
    lobber_set_transport(&p->core, status != MOVE_CLOCK_STATUS_STOPPED);

    moveforge_stereo_i16_to_float(audio_inout, p->in_l, p->in_r, frames);
    lobber_process_float(&p->core, p->in_l, p->in_r, p->out_l, p->out_r, frames);
    mf_scope_capture(&p->scope, p->out_l, p->out_r, frames);
    moveforge_stereo_float_to_i16(p->out_l, p->out_r, audio_inout, frames);
}

static void set_param(void *instance, const char *key, const char *val) {
    lobber_plugin_t *p = (lobber_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "preset") == 0) {
        p->current_preset = lobber_clamp_preset_index(atoi(val));
        lobber_apply_preset(&p->core, p->current_preset);
        return;
    }
    lobber_set_param(&p->core, lobber_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    lobber_plugin_t *p = (lobber_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    if (strcmp(key, "preset_count") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", lobber_preset_count());
    }
    if (strcmp(key, "preset") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", p->current_preset);
    }
    if (strcmp(key, "preset_name") == 0) {
        return snprintf(buf, (size_t)buf_len, "%s", lobber_preset_name(p->current_preset));
    }
    if (strcmp(key, "__scope") == 0) {
        return mf_scope_serialize(&p->scope, buf, buf_len);
    }
    int id = lobber_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", lobber_get_param(&p->core, id));
}

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    lobber_plugin_t *p = (lobber_plugin_t*)instance;
    (void)source;
    if (!p || !msg || len < 3) return;
    lobber_handle_midi(&p->core, msg[0], msg[1], msg[2]);
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
    g_host = host;
    return &g_api;
}

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"
#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/scope.h"
#include "ballast_core.h"
#include "ballast_presets.gen.inc"
/* Output-waveform scope: style/mode/window are the single source of truth in
 * capabilities.scope (module.json); set style to "none" there to disable.
 * GENERATED -- re-run gen-params after editing the scope block. */
#include "ballast_scope.gen.inc"

typedef struct {
    ballast_core_t core;
    int current_preset;
    mf_scope_t scope;
} ballast_plugin_t;

static const host_api_v1_t *g_host = NULL;

static void* create_instance(const char *module_dir, const char *json_defaults) {
    (void)module_dir;
    (void)json_defaults;
    ballast_plugin_t *p = (ballast_plugin_t*)calloc(1, sizeof(ballast_plugin_t));
    if (!p) return NULL;
    ballast_init(&p->core);
    /* Deliberately no preset at create: ballast_init has applied
     * module.json's defaults, and preset selection is the host's
     * (chain_patch.c:1345 sends set_param("preset")). -1 = none selected,
     * so any first pick applies. */
    p->current_preset = -1;
    mf_scope_init(&p->scope, BALLAST_SCOPE_WINDOW, BALLAST_SCOPE_MODE, BALLAST_SCOPE_STYLE);
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static void on_midi(void *instance, const uint8_t *msg, int len, int source) {
    (void)source;
    ballast_plugin_t *p = (ballast_plugin_t*)instance;
    if (!p || len < 3) return;
    uint8_t status = msg[0] & 0xF0;
    if (status == 0x90 && msg[2] > 0) {
        ballast_note_on(&p->core, msg[1], (float)msg[2] / 127.0f);
        mf_scope_arm(&p->scope);  /* restart the scope frame on note onset */
    } else if (status == 0x80 || (status == 0x90 && msg[2] == 0)) {
        ballast_note_off(&p->core, msg[1]);
    } else if (status == 0xE0) {
        ballast_pitch_bend(&p->core, moveforge_midi_bend_normalized(msg[1], msg[2]));
    }
}

static void set_param(void *instance, const char *key, const char *val) {
    ballast_plugin_t *p = (ballast_plugin_t*)instance;
    if (!p || !key || !val) return;
    if (strcmp(key, "all_notes_off") == 0) {
        ballast_all_notes_off(&p->core);
        return;
    }
    if (strcmp(key, "preset") == 0) {
        /* Idempotent on purpose. The host enrols "preset" in its audio-thread
         * smoother — is_smoothable_float("0") and ("1") both return 1, and
         * "preset" is not a module.json param so there is no type info to
         * exclude it — then re-sends every enrolled key whenever any one of
         * them moves. Applying it unconditionally therefore reset every
         * parameter on each detent of an unrelated encoder. */
        int next = ballast_clamp_preset_index(atoi(val));
        if (next == p->current_preset) return;
        p->current_preset = next;
        ballast_all_notes_off(&p->core);
        ballast_apply_preset(&p->core, p->current_preset);
        return;
    }
    ballast_set_param(&p->core, ballast_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    ballast_plugin_t *p = (ballast_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    if (strcmp(key, "preset_count") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", ballast_preset_count());
    }
    if (strcmp(key, "preset") == 0) {
        return snprintf(buf, (size_t)buf_len, "%d", p->current_preset);
    }
    if (strcmp(key, "preset_name") == 0) {
        return snprintf(buf, (size_t)buf_len, "%s", ballast_preset_name(p->current_preset));
    }
    if (strcmp(key, "__scope") == 0) {
        return mf_scope_serialize(&p->scope, buf, buf_len);
    }
    int param_id = ballast_param_id(key);
    if (param_id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", ballast_get_param(&p->core, param_id));
}

static int get_error(void *instance, char *buf, int buf_len) {
    (void)instance;
    if (buf && buf_len > 0) buf[0] = '\0';
    return 0;
}

static void render_block(void *instance, int16_t *out, int frames) {
    ballast_plugin_t *p = (ballast_plugin_t*)instance;
    if (!p || !out || frames <= 0) return;

    float left[MOVEFORGE_BLOCK_FRAMES];
    float right[MOVEFORGE_BLOCK_FRAMES];
    if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;
    ballast_process_float(&p->core, NULL, NULL, left, right, frames);
    mf_scope_capture(&p->scope, left, right, frames);
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
    if (g_host && g_host->log) g_host->log("[ballast] init v2");
    return &g_api;
}

#include <stddef.h>
#include <stdint.h>

#include "host/plugin_api_v1.h"

#define BLOCK_FRAMES 128

extern plugin_api_v2_t* move_plugin_init_v2(const host_api_v1_t *host);

static plugin_api_v2_t *g_api = NULL;
static void *g_instance = NULL;

static int16_t g_out_i16[BLOCK_FRAMES * 2];
static float g_out_l[BLOCK_FRAMES];
static float g_out_r[BLOCK_FRAMES];

static char g_key_buf[64];
static char g_val_buf[128];

static void host_log_stub(const char *msg) { (void)msg; }
static int host_midi_send_stub(const uint8_t *msg, int len) { (void)msg; (void)len; return 0; }
static int host_get_clock_status_stub(void) { return 0; }
static float host_get_bpm_stub(void) { return 120.0f; }

static host_api_v1_t g_glue_host = {
    .api_version = 1,
    .sample_rate = 44100,
    .frames_per_block = BLOCK_FRAMES,
    .mapped_memory = NULL,
    .audio_out_offset = 256,
    .audio_in_offset = 2304,
    .log = host_log_stub,
    .midi_send_internal = host_midi_send_stub,
    .midi_send_external = host_midi_send_stub,
    .get_clock_status = host_get_clock_status_stub,
    .mod_emit_value = NULL,
    .mod_clear_source = NULL,
    .mod_host_ctx = NULL,
    .get_bpm = host_get_bpm_stub,
    .midi_inject_to_move = NULL,
    .slot_recv_channel = NULL
};

__attribute__((export_name("sch_init")))
void sch_init(void) {
    if (!g_api) g_api = move_plugin_init_v2(&g_glue_host);
    if (!g_api) return;
    if (g_instance) g_api->destroy_instance(g_instance);
    g_instance = g_api->create_instance("", NULL);
}

__attribute__((export_name("sch_key_buf")))
char* sch_key_buf(void) { return g_key_buf; }

__attribute__((export_name("sch_val_buf")))
char* sch_val_buf(void) { return g_val_buf; }

__attribute__((export_name("sch_key_buf_size")))
int sch_key_buf_size(void) { return (int)sizeof(g_key_buf); }

__attribute__((export_name("sch_val_buf_size")))
int sch_val_buf_size(void) { return (int)sizeof(g_val_buf); }

__attribute__((export_name("sch_set_param")))
void sch_set_param(void) {
    if (!g_api || !g_instance) return;
    g_key_buf[sizeof(g_key_buf) - 1] = '\0';
    g_val_buf[sizeof(g_val_buf) - 1] = '\0';
    g_api->set_param(g_instance, g_key_buf, g_val_buf);
}

__attribute__((export_name("sch_midi")))
void sch_midi(int status, int d1, int d2) {
    if (!g_api || !g_instance) return;
    uint8_t msg[3] = { (uint8_t)status, (uint8_t)d1, (uint8_t)d2 };
    g_api->on_midi(g_instance, msg, 3, /*source=*/0);
}

__attribute__((export_name("sch_render")))
void sch_render(int frames) {
    if (!g_api || !g_instance) return;
    if (frames <= 0) return;
    if (frames > BLOCK_FRAMES) frames = BLOCK_FRAMES;
    g_api->render_block(g_instance, g_out_i16, frames);
    for (int i = 0; i < frames; i++) {
        g_out_l[i] = (float)g_out_i16[i * 2]     / 32768.0f;
        g_out_r[i] = (float)g_out_i16[i * 2 + 1] / 32768.0f;
    }
}

__attribute__((export_name("sch_left_ptr")))
float* sch_left_ptr(void) { return g_out_l; }

__attribute__((export_name("sch_right_ptr")))
float* sch_right_ptr(void) { return g_out_r; }

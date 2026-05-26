#include <stddef.h>
#include <stdint.h>

#include "host/midi_fx_api_v1.h"

#define BLOCK_FRAMES 128
#define MAX_OUT_MSGS 32

extern midi_fx_api_v1_t* move_midi_fx_init(const host_api_v1_t *host);

static midi_fx_api_v1_t *g_api = NULL;
static void *g_instance = NULL;

static char g_key_buf[64];
static char g_val_buf[128];

static uint8_t g_out_msgs[MAX_OUT_MSGS][3];
static int g_out_lens[MAX_OUT_MSGS];
static uint8_t g_out_flat[MAX_OUT_MSGS * 3];

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

static int flatten_out(int count) {
    if (count < 0) return 0;
    if (count > MAX_OUT_MSGS) count = MAX_OUT_MSGS;
    for (int i = 0; i < count; i++) {
        g_out_flat[i * 3 + 0] = g_out_msgs[i][0];
        g_out_flat[i * 3 + 1] = g_out_msgs[i][1];
        g_out_flat[i * 3 + 2] = g_out_msgs[i][2];
    }
    return count;
}

__attribute__((export_name("mf_init")))
void mf_init(void) {
    if (!g_api) g_api = move_midi_fx_init(&g_glue_host);
    if (!g_api) return;
    if (g_instance) g_api->destroy_instance(g_instance);
    g_instance = g_api->create_instance("", NULL);
}

__attribute__((export_name("mf_key_buf")))
char* mf_key_buf(void) { return g_key_buf; }

__attribute__((export_name("mf_val_buf")))
char* mf_val_buf(void) { return g_val_buf; }

__attribute__((export_name("mf_key_buf_size")))
int mf_key_buf_size(void) { return (int)sizeof(g_key_buf); }

__attribute__((export_name("mf_val_buf_size")))
int mf_val_buf_size(void) { return (int)sizeof(g_val_buf); }

__attribute__((export_name("mf_set_param")))
void mf_set_param(void) {
    if (!g_api || !g_instance) return;
    g_key_buf[sizeof(g_key_buf) - 1] = '\0';
    g_val_buf[sizeof(g_val_buf) - 1] = '\0';
    g_api->set_param(g_instance, g_key_buf, g_val_buf);
}

__attribute__((export_name("mf_process_midi_byte")))
int mf_process_midi_byte(int status, int d1, int d2) {
    if (!g_api || !g_instance) return 0;
    uint8_t in_msg[3] = { (uint8_t)status, (uint8_t)d1, (uint8_t)d2 };
    int n = g_api->process_midi(g_instance, in_msg, 3, g_out_msgs, g_out_lens, MAX_OUT_MSGS);
    return flatten_out(n);
}

__attribute__((export_name("mf_tick")))
int mf_tick(int frames) {
    if (!g_api || !g_instance) return 0;
    if (frames <= 0) return 0;
    int n = g_api->tick(g_instance, frames, (int)g_glue_host.sample_rate,
                        g_out_msgs, g_out_lens, MAX_OUT_MSGS);
    return flatten_out(n);
}

__attribute__((export_name("mf_out_buf_ptr")))
uint8_t* mf_out_buf_ptr(void) { return g_out_flat; }

__attribute__((export_name("mf_out_buf_size")))
int mf_out_buf_size(void) { return MAX_OUT_MSGS * 3; }

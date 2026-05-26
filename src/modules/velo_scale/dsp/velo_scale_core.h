#ifndef VELO_SCALE_CORE_H
#define VELO_SCALE_CORE_H

#include <stdint.h>

typedef struct {
    float scale;
} velo_scale_core_t;

void velo_scale_init(velo_scale_core_t *s);
void velo_scale_apply_defaults(velo_scale_core_t *s);
int velo_scale_param_id(const char *key);
void velo_scale_set_param(velo_scale_core_t *s, int param_id, float value);
float velo_scale_get_param(const velo_scale_core_t *s, int param_id);

/* Process one inbound MIDI message. Writes 0..max_out 3-byte messages into
 * out_msgs and their lengths into out_lens. Returns emitted count. */
int velo_scale_process_midi(velo_scale_core_t *s,
                           const uint8_t *in_msg, int in_len,
                           uint8_t out_msgs[][3], int out_lens[], int max_out);

/* Periodic tick (once per audio block). Emit unsolicited messages
 * (e.g. clock, arpeggiator). Returns emitted count. */
int velo_scale_tick(velo_scale_core_t *s,
                   int frames, int sample_rate,
                   uint8_t out_msgs[][3], int out_lens[], int max_out);

#endif

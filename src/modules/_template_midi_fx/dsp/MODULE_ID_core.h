#ifndef MODULE_UPPER_CORE_H
#define MODULE_UPPER_CORE_H

#include <stdint.h>

typedef struct {
    float scale;
} MODULE_ID_core_t;

void MODULE_ID_init(MODULE_ID_core_t *s);
void MODULE_ID_apply_defaults(MODULE_ID_core_t *s);
int MODULE_ID_param_id(const char *key);
void MODULE_ID_set_param(MODULE_ID_core_t *s, int param_id, float value);
float MODULE_ID_get_param(const MODULE_ID_core_t *s, int param_id);

/* Process one inbound MIDI message. Writes 0..max_out 3-byte messages into
 * out_msgs and their lengths into out_lens. Returns emitted count. */
int MODULE_ID_process_midi(MODULE_ID_core_t *s,
                           const uint8_t *in_msg, int in_len,
                           uint8_t out_msgs[][3], int out_lens[], int max_out);

/* Periodic tick (once per audio block). Emit unsolicited messages
 * (e.g. clock, arpeggiator). Returns emitted count. */
int MODULE_ID_tick(MODULE_ID_core_t *s,
                   int frames, int sample_rate,
                   uint8_t out_msgs[][3], int out_lens[], int max_out);

#endif

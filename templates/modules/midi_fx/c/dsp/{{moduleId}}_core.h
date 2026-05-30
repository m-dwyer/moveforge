#ifndef {{moduleUpper}}_CORE_H
#define {{moduleUpper}}_CORE_H

#include <stdint.h>

typedef struct {
    float scale;
} {{moduleId}}_core_t;

void {{moduleId}}_init({{moduleId}}_core_t *s);
void {{moduleId}}_apply_defaults({{moduleId}}_core_t *s);
int {{moduleId}}_param_id(const char *key);
void {{moduleId}}_set_param({{moduleId}}_core_t *s, int param_id, float value);
float {{moduleId}}_get_param(const {{moduleId}}_core_t *s, int param_id);

/* Process one inbound MIDI message. Writes 0..max_out 3-byte messages into
 * out_msgs and their lengths into out_lens. Returns emitted count. */
int {{moduleId}}_process_midi({{moduleId}}_core_t *s,
                           const uint8_t *in_msg, int in_len,
                           uint8_t out_msgs[][3], int out_lens[], int max_out);

/* Periodic tick (once per audio block). Emit unsolicited messages
 * (e.g. clock, arpeggiator). Returns emitted count. */
int {{moduleId}}_tick({{moduleId}}_core_t *s,
                   int frames, int sample_rate,
                   uint8_t out_msgs[][3], int out_lens[], int max_out);

#endif

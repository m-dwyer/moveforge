#ifndef ARPY_CORE_H
#define ARPY_CORE_H

#include <stdint.h>

typedef struct {
    float pattern; /* 0=off (passthrough), 1=up, 2=down, 3=up-down */
    float chord;   /* 0=single, 1=octave, 2=power, 3=triad, 4=dom7 */
    float rate;    /* 0..1 -> step interval in ms (mapped in core) */

    int held_active;
    uint8_t held_note;
    uint8_t held_velocity;
    uint8_t held_channel;

    int step_index;
    int frames_to_next_step;
    int frames_until_gate_off;
    int8_t playing_note; /* -1 if no arp note currently sounding */
} arpy_core_t;

void arpy_init(arpy_core_t *s);
void arpy_apply_defaults(arpy_core_t *s);
int arpy_param_id(const char *key);
void arpy_set_param(arpy_core_t *s, int param_id, float value);
float arpy_get_param(const arpy_core_t *s, int param_id);

int arpy_process_midi(arpy_core_t *s,
                      const uint8_t *in_msg, int in_len,
                      uint8_t out_msgs[][3], int out_lens[], int max_out);

int arpy_tick(arpy_core_t *s,
              int frames, int sample_rate,
              uint8_t out_msgs[][3], int out_lens[], int max_out);

#endif

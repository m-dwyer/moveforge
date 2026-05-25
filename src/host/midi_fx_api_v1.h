/*
 * Schwung MIDI FX API v1
 *
 * Local reference of upstream src/host/midi_fx_api_v1.h. Modules with
 * component_type == "midi_fx" export move_midi_fx_init returning a pointer
 * to a midi_fx_api_v1_t.
 *
 * Differs from sound_generator/audio_fx APIs: no audio I/O. process_midi()
 * handles one incoming message and emits up to max_out outgoing messages;
 * tick() emits unsolicited messages on a timer.
 */

#ifndef MOVE_MIDI_FX_API_V1_H
#define MOVE_MIDI_FX_API_V1_H

#include <stdint.h>
#include "plugin_api_v1.h"

#define MOVE_MIDI_FX_API_VERSION 1

typedef struct midi_fx_api_v1 {
    uint32_t api_version;  /* must be MOVE_MIDI_FX_API_VERSION */

    void* (*create_instance)(const char *module_dir, const char *config_json);
    void  (*destroy_instance)(void *instance);

    /* Handle one inbound MIDI message. Write 0..max_out outbound messages
     * into out_msgs[][3] (3-byte messages: status, d1, d2) and set the
     * corresponding out_lens[i]. Return the number of outbound messages. */
    int (*process_midi)(void *instance,
                        const uint8_t *in_msg, int in_len,
                        uint8_t out_msgs[][3], int out_lens[], int max_out);

    /* Periodic tick. Called once per audio block (128 frames @ 44.1 kHz).
     * Emit unsolicited messages (e.g. clock, arpeggiator notes). Same
     * out_msgs/out_lens convention as process_midi. Return emitted count. */
    int (*tick)(void *instance,
                int frames, int sample_rate,
                uint8_t out_msgs[][3], int out_lens[], int max_out);

    void (*set_param)(void *instance, const char *key, const char *val);
    int  (*get_param)(void *instance, const char *key, char *buf, int buf_len);
} midi_fx_api_v1_t;

midi_fx_api_v1_t* move_midi_fx_init(const host_api_v1_t *host);

#endif

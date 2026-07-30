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

/* The out_msgs capacity the chain host actually passes as `max_out`, for both
 * process_midi and tick (schwung 0.11.4, src/modules/chain/dsp/chain_midi.c:318-322,
 * :358-361). Upstream spells it MIDI_FX_MAX_OUT_MSGS; this copy prefixes it like
 * the version macro above.
 *
 * It lives here because leaving it out meant each harness picked its own number
 * and neither matched the device: the offline trace gave modules 8 and the browser
 * gave them 32, so a module emitting 9-16 messages was under-reported in goldens
 * and one emitting 17-32 worked in the browser and was truncated on hardware.
 * Anything calling process_midi or tick uses this, not a local constant. */
#define MOVE_MIDI_FX_MAX_OUT_MSGS 16

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

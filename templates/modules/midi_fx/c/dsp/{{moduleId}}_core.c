#include "{{moduleId}}_core.h"
#include <string.h>

#include "{{moduleId}}_params.gen.inc"

void {{moduleId}}_init({{moduleId}}_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    {{moduleId}}_apply_defaults(s);
}

int {{moduleId}}_process_midi({{moduleId}}_core_t *s,
                           const uint8_t *in_msg, int in_len,
                           uint8_t out_msgs[][3], int out_lens[], int max_out) {
    if (!s || !in_msg || in_len < 1 || max_out < 1) return 0;

    uint8_t status = in_msg[0] & 0xF0;
    out_msgs[0][0] = in_msg[0];
    out_msgs[0][1] = in_len > 1 ? in_msg[1] : 0;
    out_msgs[0][2] = in_len > 2 ? in_msg[2] : 0;
    out_lens[0] = in_len;

    /* Scale velocity on note-on messages (status 0x90, velocity > 0). */
    if (status == 0x90 && in_len >= 3 && in_msg[2] > 0) {
        float scaled = (float)in_msg[2] * s->scale;
        if (scaled < 1.0f) scaled = 1.0f;
        if (scaled > 127.0f) scaled = 127.0f;
        out_msgs[0][2] = (uint8_t)scaled;
    }
    return 1;
}

int {{moduleId}}_tick({{moduleId}}_core_t *s,
                   int frames, int sample_rate,
                   uint8_t out_msgs[][3], int out_lens[], int max_out) {
    (void)s;
    (void)frames;
    (void)sample_rate;
    (void)out_msgs;
    (void)out_lens;
    (void)max_out;
    return 0;
}

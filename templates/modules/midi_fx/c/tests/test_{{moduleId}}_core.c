#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "{{moduleId}}_core.h"

static void require_true(int condition, const char *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
}

int main(void) {
    {{moduleId}}_core_t fx;
    {{moduleId}}_init(&fx);

    int scale_id = {{moduleId}}_param_id("scale");
    require_true(scale_id >= 0, "param lookup works");
    require_true({{moduleId}}_param_id("does_not_exist") < 0, "unknown param lookup fails");

    /* Clamp test */
    {{moduleId}}_set_param(&fx, scale_id, 10.0f);
    require_true({{moduleId}}_get_param(&fx, scale_id) <= 2.0f, "scale clamps high");

    /* Scale down: vel 100 * 0.5 -> 50 */
    {{moduleId}}_set_param(&fx, scale_id, 0.5f);
    uint8_t in_note_on[3] = { 0x90, 60, 100 };
    uint8_t out_msgs[4][3];
    int out_lens[4];
    int emitted = {{moduleId}}_process_midi(&fx, in_note_on, 3, out_msgs, out_lens, 4);
    require_true(emitted == 1, "note-on emits one message");
    require_true(out_msgs[0][0] == 0x90, "status preserved");
    require_true(out_msgs[0][1] == 60, "note preserved");
    require_true(out_msgs[0][2] == 50, "velocity scaled to 50");

    /* Note-off passes through untouched */
    uint8_t in_note_off[3] = { 0x80, 60, 0 };
    emitted = {{moduleId}}_process_midi(&fx, in_note_off, 3, out_msgs, out_lens, 4);
    require_true(emitted == 1 && out_msgs[0][0] == 0x80 && out_msgs[0][2] == 0, "note-off passthrough");

    /* Scale clamps to >= 1 even when input * scale rounds below 1 */
    {{moduleId}}_set_param(&fx, scale_id, 0.0f);
    uint8_t in_quiet[3] = { 0x90, 60, 1 };
    {{moduleId}}_process_midi(&fx, in_quiet, 3, out_msgs, out_lens, 4);
    require_true(out_msgs[0][2] >= 1, "velocity clamps to 1 minimum");

    /* Tick emits nothing in this passthrough template */
    int ticked = {{moduleId}}_tick(&fx, 128, 44100, out_msgs, out_lens, 4);
    require_true(ticked == 0, "tick emits nothing");

    printf("{{moduleId}} core tests passed\n");
    return 0;
}

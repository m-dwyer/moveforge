#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/midi_fx_api_v1.h"

extern midi_fx_api_v1_t* move_midi_fx_init(const host_api_v1_t *host);

#define OUT_MAX 8

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static int get_int(midi_fx_api_v1_t *api, void *inst, const char *key) {
    char buf[64];
    int n = api->get_param(inst, key, buf, sizeof(buf));
    require_true(n >= 0, key);
    return atoi(buf);
}

static float get_float(midi_fx_api_v1_t *api, void *inst, const char *key) {
    char buf[64];
    int n = api->get_param(inst, key, buf, sizeof(buf));
    require_true(n >= 0, key);
    return (float)atof(buf);
}

int main(void) {
    host_api_v1_t host = {0};
    host.api_version = MOVE_PLUGIN_API_VERSION;
    host.sample_rate = MOVE_SAMPLE_RATE;
    host.frames_per_block = MOVE_FRAMES_PER_BLOCK;

    midi_fx_api_v1_t *api = move_midi_fx_init(&host);
    require_true(api != NULL, "init returns api");
    void *inst = api->create_instance(".", NULL);
    require_true(inst != NULL, "create instance");

    uint8_t out[OUT_MAX][3];
    int lens[OUT_MAX];
    char name[64];

    /* No preset is elected at create: the module comes up on module.json's
     * declared defaults and leaves preset choice to the host. This matters
     * more for arpy than for any other module — its preset 0 is "Off"
     * (pattern 0), which is straight MIDI pass-through, so electing it at
     * create would ship an arpeggiator that does nothing when inserted. */
    /* Asserted behaviourally first, because that is the failure a user sees:
     * with the pattern running, a note-on arms the arpeggiator and emits
     * nothing directly — the notes come out of tick(). Under preset 0 ("Off",
     * pattern 0) it is echoed straight back here instead, and an arpeggiator
     * inserted into a chain does nothing at all. */
    uint8_t note_on[3] = {0x90, 60, 100};
    int n = api->process_midi(inst, note_on, 3, out, lens, OUT_MAX);
    require_true(n == 0, "a fresh arpy arms the arpeggiator rather than passing the note through");

    n = api->tick(inst, MOVE_FRAMES_PER_BLOCK, MOVE_SAMPLE_RATE, out, lens, OUT_MAX);
    require_true(n >= 1, "a fresh arpy emits its first step from tick");
    require_true((out[0][0] & 0xF0) == 0x90 && out[0][2] > 0, "first emitted step is a note-on");

    require_true(get_int(api, inst, "preset_count") == 4, "preset_count");
    require_true(get_int(api, inst, "preset") == -1, "no preset selected at create");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) >= 0, "initial preset_name");
    require_true(name[0] == '\0', "no preset name before one is selected");
    require_true(get_float(api, inst, "pattern") > 0.5f, "create leaves module.json default for pattern");

    uint8_t note_off[3] = {0x80, 60, 0};
    api->process_midi(inst, note_off, 3, out, lens, OUT_MAX);

    /* Selecting preset 0 must apply it: the sentinel must not let index 0 look
     * unchanged and get skipped by the idempotence guard. Preset 0 is "Off",
     * so the pass-through behaviour returns. */
    api->set_param(inst, "preset", "0");
    require_true(get_int(api, inst, "preset") == 0, "preset 0 is selectable");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "preset 0 name");
    require_true(strcmp(name, "Off") == 0, "preset 0 name is Off");
    require_true(get_float(api, inst, "pattern") < 0.5f, "preset 0 is actually applied");

    n = api->process_midi(inst, note_on, 3, out, lens, OUT_MAX);
    require_true(n == 1, "preset Off passes the note straight through");
    require_true(out[0][1] == 60, "passed-through note keeps its pitch");
    api->process_midi(inst, note_off, 3, out, lens, OUT_MAX);

    api->set_param(inst, "preset", "2");
    require_true(get_int(api, inst, "preset") == 2, "selected preset");
    require_true(get_float(api, inst, "pattern") > 0.5f, "selected preset applies params");

    api->destroy_instance(inst);
    printf("arpy plugin tests passed\n");
    return 0;
}

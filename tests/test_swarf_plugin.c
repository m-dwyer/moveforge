#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"

extern plugin_api_v2_t* move_plugin_init_v2(const host_api_v1_t *host);

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static int get_int(plugin_api_v2_t *api, void *inst, const char *key) {
    char buf[64];
    int n = api->get_param(inst, key, buf, sizeof(buf));
    require_true(n >= 0, key);
    return atoi(buf);
}

static float get_float(plugin_api_v2_t *api, void *inst, const char *key) {
    char buf[64];
    int n = api->get_param(inst, key, buf, sizeof(buf));
    require_true(n >= 0, key);
    return (float)atof(buf);
}

/* Presets only reach the device through the wrapper's set_param("preset"), and
 * nothing else in the local pipeline exercises that path: the render harness
 * sets every param explicitly, so a module whose preset selection did nothing
 * would still render and validate clean. Hence a plugin-level test. */
int main(void) {
    host_api_v1_t host = {0};
    host.api_version = MOVE_PLUGIN_API_VERSION;
    host.sample_rate = MOVE_SAMPLE_RATE;
    host.frames_per_block = MOVE_FRAMES_PER_BLOCK;

    plugin_api_v2_t *api = move_plugin_init_v2(&host);
    require_true(api != NULL, "init returns api");
    void *inst = api->create_instance(".", NULL);
    require_true(inst != NULL, "create instance");

    char name[64];

    /* No preset is elected at create: the module comes up on module.json's
     * declared defaults, which is what the host seeds its knobs from, and
     * leaves preset choice to the host. */
    require_true(get_int(api, inst, "preset_count") > 0, "preset_count");
    require_true(get_int(api, inst, "preset") == -1, "no preset selected at create");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) >= 0, "initial preset_name");
    require_true(name[0] == '\0', "no preset name before one is selected");

    /* Selecting a preset must actually apply its params, not just record the
     * index — a preset screen that browses and does nothing is the failure
     * this test exists for. Moving the param away first makes the assertion
     * hold even when preset 0 equals the module.json defaults. */
    api->set_param(inst, "volume", "0.25");
    require_true(get_float(api, inst, "volume") < 0.26f, "set_param moves the param");

    api->set_param(inst, "preset", "0");
    require_true(get_int(api, inst, "preset") == 0, "preset 0 is selectable");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "preset 0 name");
    require_true(strcmp(name, "Init") == 0, "preset 0 name is Init");
    /* Init names no parameters at all — it *is* module.json's defaults, which is the
     * flagship kit and the power-on state. So selecting it must restore the declared
     * default, which is exactly what a sparse preset promises. */
    require_true(get_float(api, inst, "volume") > 0.75f - 0.001f
                     && get_float(api, inst, "volume") < 0.75f + 0.001f,
                 "selecting preset 0 applies its params");

    /* Re-selecting the same index is a no-op, so a param moved since then is
     * left alone: set_param("preset") is called on every knob turn. */
    api->set_param(inst, "volume", "0.25");
    api->set_param(inst, "preset", "0");
    require_true(get_float(api, inst, "volume") < 0.26f, "re-selecting the same preset does not reapply it");

    /* The -12 dBFS reference, asserted through the whole wrapper rather than only in
     * a golden — goldens say "unchanged", and a bless can walk a reference away.
     * Every kit is driven at full velocity on all six voices at once, which is
     * harder than any of their own render patterns. */
    int worst_preset = -1;
    float worst_peak = 0.0f;
    for (int p = 0; p < get_int(api, inst, "preset_count"); p++) {
        void *k = api->create_instance(".", NULL);
        require_true(k != NULL, "create instance per kit");
        char index[8];
        snprintf(index, sizeof(index), "%d", p);
        api->set_param(k, "preset", index);
        for (int v = 0; v < 6; v++) {
            uint8_t on[3] = { 0x90, (uint8_t)(36 + v), 127 };
            api->on_midi(k, on, 3, MOVE_MIDI_SOURCE_HOST);
        }
        int16_t block[MOVE_FRAMES_PER_BLOCK * 2];
        float peak = 0.0f;
        for (int b = 0; b < 344; b++) {   /* ~1 s */
            api->render_block(k, block, MOVE_FRAMES_PER_BLOCK);
            for (int i = 0; i < MOVE_FRAMES_PER_BLOCK * 2; i++) {
                float mag = (float)(block[i] < 0 ? -block[i] : block[i]) / 32768.0f;
                if (mag > peak) peak = mag;
            }
        }
        if (peak > worst_peak) { worst_peak = peak; worst_preset = p; }
        api->destroy_instance(k);
    }
    /* Four chain slots sum at unity into one int16 mailbox and nothing clamps between
     * stages, so an overshoot wraps rather than clips. -6 dBFS with all six voices at
     * full velocity leaves the room that needs. */
    if (worst_peak > 0.5f) {
        fprintf(stderr, "FAIL: preset %d peaks at %.1f dBFS with all six voices at "
                        "velocity 127\n", worst_preset, 20.0f * log10f(worst_peak));
        exit(1);
    }
    require_true(worst_peak > 0.05f, "the kits are not silent");

    api->destroy_instance(inst);
    printf("swarf plugin tests passed\n");
    return 0;
}

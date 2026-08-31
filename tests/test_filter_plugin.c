#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/audio_fx_api_v2.h"

extern audio_fx_api_v2_t* move_audio_fx_init_v2(const host_api_v1_t *host);

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static int get_int(audio_fx_api_v2_t *api, void *inst, const char *key) {
    char buf[64];
    int n = api->get_param(inst, key, buf, sizeof(buf));
    require_true(n >= 0, key);
    return atoi(buf);
}

static float get_float(audio_fx_api_v2_t *api, void *inst, const char *key) {
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

    audio_fx_api_v2_t *api = move_audio_fx_init_v2(&host);
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
    api->set_param(inst, "cutoff", "1000");
    require_true(get_float(api, inst, "cutoff") < 1001.0f, "set_param moves the param");

    api->set_param(inst, "preset", "0");
    require_true(get_int(api, inst, "preset") == 0, "preset 0 is selectable");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "preset 0 name");
    require_true(strcmp(name, "Open") == 0, "preset 0 name is Open");
    require_true(get_float(api, inst, "cutoff") > 17999.0f
                     && get_float(api, inst, "cutoff") < 18001.0f,
                 "selecting preset 0 applies its params");

    /* Re-selecting the same index is a no-op, so a param moved since then is
     * left alone: set_param("preset") is called on every knob turn. */
    api->set_param(inst, "cutoff", "1000");
    api->set_param(inst, "preset", "0");
    require_true(get_float(api, inst, "cutoff") < 1001.0f, "re-selecting the same preset does not reapply it");

    api->destroy_instance(inst);
    printf("filter plugin tests passed\n");
    return 0;
}

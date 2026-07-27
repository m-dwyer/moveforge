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

    /* No preset is elected at create; the module comes up on module.json's
     * declared defaults. faust_drive's preset 0 happens to equal those
     * defaults, so `drive` is checked against preset 1 instead. */
    require_true(get_int(api, inst, "preset_count") == 3, "preset_count");
    require_true(get_int(api, inst, "preset") == -1, "no preset selected at create");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) >= 0, "initial preset_name");
    require_true(name[0] == '\0', "no preset name before one is selected");
    require_true(get_float(api, inst, "drive") > 0.29f && get_float(api, inst, "drive") < 0.31f,
                 "create leaves module.json default for drive");

    /* Selecting preset 0 must apply it: the sentinel must not let index 0 look
     * unchanged and get skipped by the idempotence guard. */
    api->set_param(inst, "preset", "0");
    require_true(get_int(api, inst, "preset") == 0, "preset 0 is selectable");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "preset 0 name");
    require_true(strcmp(name, "Init") == 0, "preset 0 name is Init");

    /* Selecting a preset has to change params, not just record an index —
     * browsing presets that do nothing is the plan-7.1 defect. */
    api->set_param(inst, "preset", "1");
    require_true(get_int(api, inst, "preset") == 1, "selected preset");
    require_true(get_float(api, inst, "drive") > 0.64f, "selected preset applies params");

    /* Re-selecting the same index is a no-op (plan 6.3), so a param moved
     * since then is left alone. */
    api->set_param(inst, "drive", "0.10");
    api->set_param(inst, "preset", "1");
    require_true(get_float(api, inst, "drive") < 0.11f, "re-selecting the same preset does not reapply it");

    api->destroy_instance(inst);
    printf("faust_drive plugin tests passed\n");
    return 0;
}

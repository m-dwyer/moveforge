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
     * declared defaults, which is what the host seeds its CC knobs from
     * (chain_host.c:1101 -> chain_params.c:239). Electing preset 0 instead
     * would leave the host's knob positions and the DSP disagreeing on every
     * param, since dustline's preset 0 differs from its defaults on all 8. */
    require_true(get_int(api, inst, "preset_count") == 6, "preset_count");
    require_true(get_int(api, inst, "preset") == -1, "no preset selected at create");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) >= 0, "initial preset_name");
    require_true(name[0] == '\0', "no preset name before one is selected");

    /* Every param must read back its module.json default. Spot-checked on the
     * three with the widest gap to preset 0: cutoff 0.42 vs 0.48, drive 0.22
     * vs 0.12, release 0.55 vs 0.42. */
    require_true(get_float(api, inst, "cutoff") > 0.41f && get_float(api, inst, "cutoff") < 0.43f,
                 "create leaves module.json default for cutoff");
    require_true(get_float(api, inst, "drive") > 0.21f, "create leaves module.json default for drive");
    require_true(get_float(api, inst, "release") > 0.54f, "create leaves module.json default for release");

    /* Selecting preset 0 must apply it: the sentinel must not let index 0 look
     * unchanged and get skipped by the idempotence guard. */
    api->set_param(inst, "preset", "0");
    require_true(get_int(api, inst, "preset") == 0, "preset 0 is selectable");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "preset 0 name");
    require_true(strcmp(name, "Init") == 0, "preset 0 name is Init");
    require_true(get_float(api, inst, "cutoff") > 0.47f, "preset 0 is actually applied");
    require_true(get_float(api, inst, "drive") < 0.13f, "preset 0 applies every key");

    /* Re-selecting the same index is a no-op, so a param moved since then is
     * left alone (plan 6.3's idempotence, which the -1 sentinel must not break). */
    api->set_param(inst, "drive", "0.90");
    api->set_param(inst, "preset", "0");
    require_true(get_float(api, inst, "drive") > 0.89f, "re-selecting the same preset does not reapply it");

    api->set_param(inst, "preset", "2");
    require_true(get_int(api, inst, "preset") == 2, "selected preset");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "selected preset_name");
    require_true(get_float(api, inst, "drive") < 0.89f, "a different preset does reapply");

    api->destroy_instance(inst);
    printf("dustline plugin tests passed\n");
    return 0;
}

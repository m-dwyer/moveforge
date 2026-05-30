#include <stdio.h>
#include <stdlib.h>

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

    require_true(get_int(api, inst, "preset_count") == 12, "preset_count");
    require_true(get_int(api, inst, "preset") == 0, "initial preset");

    char name[64];
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "initial preset_name");
    require_true(name[0] == 'I', "initial preset name is Init");

    api->set_param(inst, "preset", "2");
    require_true(get_int(api, inst, "preset") == 2, "selected preset");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "selected preset_name");
    require_true(name[0] == 'R', "selected preset name is Rubber Bass");
    require_true(get_float(api, inst, "fold") > 0.67f, "selected preset applies params");

    api->destroy_instance(inst);
    printf("westfold plugin tests passed\n");
    return 0;
}

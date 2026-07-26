#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "host/plugin_api_v1.h"
#include "modules/_shared/scope.h"

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

/* Deterministic golden for the shared scope helper, independent of any DSP:
 * a full-scale signal must serialize to a frame whose columns span top-to-bottom,
 * and silence must collapse to the centre row. */
static void test_scope_helper(void) {
    mf_scope_t scope;
    mf_scope_init(&scope, 1024, MF_SCOPE_ONESHOT, MF_SCOPE_ENVELOPE);

    /* one-shot must stay empty until armed */
    char buf[16384];
    float blk[128];
    for (int i = 0; i < 128; i++) blk[i] = 1.0f;
    mf_scope_capture(&scope, blk, NULL, 128);
    require_true(mf_scope_serialize(&scope, buf, sizeof(buf)) == 0, "scope empty before arm");

    /* arm, then feed a full-scale alternating signal for one full window: every
     * column's 8-sample bucket then contains both +1 and -1. */
    mf_scope_arm(&scope);
    for (int i = 0; i < 128; i++) blk[i] = (i % 2 == 0) ? 1.0f : -1.0f;
    for (int fed = 0; fed < 1024; fed += 128) {
        mf_scope_capture(&scope, blk, NULL, 128);
    }

    int n = mf_scope_serialize(&scope, buf, sizeof(buf));
    require_true(n == MF_SCOPE_COLS * 2, "scope frame length");

    /* every column of a full-scale signal should span near the full height:
     * max-row near the top (small char), min-row near the bottom (large char) */
    int spanning = 0;
    for (int c = 0; c < MF_SCOPE_COLS; c++) {
        int topRow = buf[c * 2] - MF_SCOPE_ENC_BASE;
        int botRow = buf[c * 2 + 1] - MF_SCOPE_ENC_BASE;
        require_true(topRow >= 0 && topRow < MF_SCOPE_ROWS, "scope top row in range");
        require_true(botRow >= 0 && botRow < MF_SCOPE_ROWS, "scope bot row in range");
        require_true(botRow >= topRow, "scope min sits below max");
        if (topRow <= 4 && botRow >= MF_SCOPE_ROWS - 5) spanning++;
    }
    require_true(spanning > MF_SCOPE_COLS / 2, "full-scale sine spans the display");

    /* silence is squelched: a near-zero frame serves nothing, so the UI never
     * shows the scope while the voice is idle */
    mf_scope_init(&scope, 1024, MF_SCOPE_CONTINUOUS, MF_SCOPE_ENVELOPE);
    memset(blk, 0, sizeof(blk));
    for (int fed = 0; fed < 1024; fed += 128) mf_scope_capture(&scope, blk, NULL, 128);
    require_true(mf_scope_serialize(&scope, buf, sizeof(buf)) == 0, "silence is squelched");

    /* a quiet-but-audible signal (above squelch) still serves a frame */
    mf_scope_init(&scope, 1024, MF_SCOPE_CONTINUOUS, MF_SCOPE_ENVELOPE);
    for (int i = 0; i < 128; i++) blk[i] = (i % 2 == 0) ? 0.1f : -0.1f;
    for (int fed = 0; fed < 1024; fed += 128) mf_scope_capture(&scope, blk, NULL, 128);
    require_true(mf_scope_serialize(&scope, buf, sizeof(buf)) == MF_SCOPE_COLS * 2, "audible signal serves a frame");

    int centre = (int)((1.0f - 0.0f) * 0.5f * (MF_SCOPE_ROWS - 1) + 0.5f);
    require_true((mf_scope_enc(0.0f) - MF_SCOPE_ENC_BASE) == centre, "zero encodes centre row");
}

/* Style coverage: line collapses each column to a single sample (min==max),
 * none disables capture entirely, triggered still produces a frame. */
static void test_scope_styles(void) {
    mf_scope_t scope;
    char buf[16384];
    float blk[128];

    /* NONE: never serves a frame even with full-scale audio */
    mf_scope_init(&scope, 1024, MF_SCOPE_CONTINUOUS, MF_SCOPE_NONE);
    for (int i = 0; i < 128; i++) blk[i] = 1.0f;
    for (int fed = 0; fed < 2048; fed += 128) mf_scope_capture(&scope, blk, NULL, 128);
    require_true(mf_scope_serialize(&scope, buf, sizeof(buf)) == 0, "none style stays disabled");

    /* LINE connects consecutive decimated samples: with a rising ramp each
     * column's bar spans to the next column's sample, so bars have height
     * (top != bot) -- a joined trace, not disconnected dots. */
    mf_scope_init(&scope, 1024, MF_SCOPE_CONTINUOUS, MF_SCOPE_LINE);
    for (int fed = 0; fed < 1024; fed += 128) {
        for (int i = 0; i < 128; i++) blk[i] = -1.0f + 2.0f * (float)(fed + i) / 1024.0f;
        mf_scope_capture(&scope, blk, NULL, 128);
    }
    require_true(mf_scope_serialize(&scope, buf, sizeof(buf)) == MF_SCOPE_COLS * 2, "line frame length");
    int connected = 0;
    for (int c = 0; c < MF_SCOPE_COLS - 1; c++) {
        if (buf[c * 2] != buf[c * 2 + 1]) { connected = 1; break; }
    }
    require_true(connected, "line style joins consecutive samples into a trace");

    /* TRIGGERED: a full-scale sine still publishes a frame (timeout guarantees
     * progress even if the trigger search were unlucky) */
    mf_scope_init(&scope, 512, MF_SCOPE_CONTINUOUS, MF_SCOPE_TRIGGERED);
    for (int blkn = 0; blkn < 24; blkn++) {
        for (int i = 0; i < 128; i++) {
            int s = blkn * 128 + i;
            blk[i] = sinf((float)s / 64.0f * 6.2831853f);  /* ~2 cycles per 128 */
        }
        mf_scope_capture(&scope, blk, NULL, 128);
    }
    require_true(mf_scope_serialize(&scope, buf, sizeof(buf)) == MF_SCOPE_COLS * 2, "triggered publishes a frame");
}

int main(void) {
    test_scope_helper();
    test_scope_styles();

    host_api_v1_t host = {0};
    host.api_version = MOVE_PLUGIN_API_VERSION;
    host.sample_rate = MOVE_SAMPLE_RATE;
    host.frames_per_block = MOVE_FRAMES_PER_BLOCK;

    plugin_api_v2_t *api = move_plugin_init_v2(&host);
    require_true(api != NULL, "init returns api");
    void *inst = api->create_instance(".", NULL);
    require_true(inst != NULL, "create instance");

    require_true(get_int(api, inst, "preset_count") == 12, "preset_count");

    /* No preset is elected at create: the module comes up on module.json's
     * declared defaults — which is what the host seeds its knobs from — and
     * leaves preset choice to the host. `fold` distinguishes the two states:
     * module.json declares 0.35, preset 0 sets 0.22. */
    char name[64];
    require_true(get_int(api, inst, "preset") == -1, "no preset selected at create");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) >= 0, "initial preset_name");
    require_true(name[0] == '\0', "no preset name before one is selected");
    require_true(get_float(api, inst, "fold") > 0.34f, "create leaves module.json default for fold");

    /* Selecting preset 0 must apply it: the sentinel must not let index 0 look
     * unchanged and get skipped by the idempotence guard. */
    api->set_param(inst, "preset", "0");
    require_true(get_int(api, inst, "preset") == 0, "preset 0 is selectable");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "preset 0 name");
    require_true(name[0] == 'I', "preset 0 name is Init");
    require_true(get_float(api, inst, "fold") < 0.23f, "preset 0 is actually applied");

    api->set_param(inst, "preset", "2");
    require_true(get_int(api, inst, "preset") == 2, "selected preset");
    require_true(api->get_param(inst, "preset_name", name, sizeof(name)) > 0, "selected preset_name");
    require_true(name[0] == 'R', "selected preset name is Rubber Bass");
    require_true(get_float(api, inst, "fold") > 0.67f, "selected preset applies params");

    /* scope is empty until a note arms it, then populates after a window of audio */
    char scope_buf[16384];
    require_true(api->get_param(inst, "__scope", scope_buf, sizeof(scope_buf)) == 0,
                 "scope empty before any note");
    uint8_t note_on[3] = { 0x90, 60, 100 };
    api->on_midi(inst, note_on, 3, 0);
    int16_t out[MOVE_FRAMES_PER_BLOCK * 2];
    for (int b = 0; b < 16; b++) api->render_block(inst, out, MOVE_FRAMES_PER_BLOCK);
    require_true(api->get_param(inst, "__scope", scope_buf, sizeof(scope_buf)) == 256,
                 "scope populated after note + audio");

    api->destroy_instance(inst);
    printf("westfold plugin tests passed\n");
    return 0;
}

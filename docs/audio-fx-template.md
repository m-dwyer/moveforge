# Audio FX module template

The core DSP signature is general: `<module>_process_float(core, in_left, in_right, out_left, out_right, frames)`. Sound generators pass `NULL` for the input pointers. Audio FX modules pass real input buffers.

This file documents the wrapper layer that adapts a `*_process_float` core to Schwung's `audio_fx_api_v2_t` (`upstream/schwung/src/host/audio_fx_api_v2.h`) and to the offline render harness.

## Schwung audio FX wrapper

Schwung's audio FX API processes interleaved `int16_t` **in place** — same buffer for input and output. The wrapper must:

1. Allocate two scratch float buffers (per instance) for input L/R.
2. On each `process_block`:
   - Deinterleave `audio_inout` → input L/R floats.
   - Allocate or reuse output L/R floats.
   - Call `<module>_process_float(core, in_L, in_R, out_L, out_R, frames)`.
   - Interleave output floats back into `audio_inout` with clipping.

```c
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "host/audio_fx_api_v2.h"
#include "myfx_core.h"

#define BLOCK_FRAMES 128

typedef struct {
    myfx_core_t core;
    float in_l[BLOCK_FRAMES];
    float in_r[BLOCK_FRAMES];
    float out_l[BLOCK_FRAMES];
    float out_r[BLOCK_FRAMES];
} myfx_plugin_t;

static void* create_instance(const char *module_dir, const char *config_json) {
    (void)module_dir;
    (void)config_json;
    myfx_plugin_t *p = (myfx_plugin_t*)calloc(1, sizeof(myfx_plugin_t));
    if (p) myfx_init(&p->core);
    return p;
}

static void destroy_instance(void *instance) { free(instance); }

static void process_block(void *instance, int16_t *audio_inout, int frames) {
    myfx_plugin_t *p = (myfx_plugin_t*)instance;
    if (!p || !audio_inout || frames <= 0) return;
    if (frames > BLOCK_FRAMES) frames = BLOCK_FRAMES;
    for (int i = 0; i < frames; i++) {
        p->in_l[i] = audio_inout[i * 2] / 32768.0f;
        p->in_r[i] = audio_inout[i * 2 + 1] / 32768.0f;
    }
    myfx_process_float(&p->core, p->in_l, p->in_r, p->out_l, p->out_r, frames);
    for (int i = 0; i < frames; i++) {
        float l = p->out_l[i] * 32767.0f;
        float r = p->out_r[i] * 32767.0f;
        if (l > 32767.0f) l = 32767.0f; if (l < -32768.0f) l = -32768.0f;
        if (r > 32767.0f) r = 32767.0f; if (r < -32768.0f) r = -32768.0f;
        audio_inout[i * 2] = (int16_t)l;
        audio_inout[i * 2 + 1] = (int16_t)r;
    }
}

static void set_param(void *instance, const char *key, const char *val) {
    myfx_plugin_t *p = (myfx_plugin_t*)instance;
    if (p && key && val) myfx_set_param(&p->core, myfx_param_id(key), (float)atof(val));
}

static int get_param(void *instance, const char *key, char *buf, int buf_len) {
    myfx_plugin_t *p = (myfx_plugin_t*)instance;
    if (!p || !key || !buf || buf_len <= 0) return -1;
    int id = myfx_param_id(key);
    if (id < 0) return -1;
    return snprintf(buf, (size_t)buf_len, "%.6f", myfx_get_param(&p->core, id));
}

static void on_midi(void *i, const uint8_t *m, int l, int s) { (void)i; (void)m; (void)l; (void)s; }

static audio_fx_api_v2_t g_api = {
    .api_version = AUDIO_FX_API_VERSION_2,
    .create_instance = create_instance,
    .destroy_instance = destroy_instance,
    .process_block = process_block,
    .set_param = set_param,
    .get_param = get_param,
    .on_midi = on_midi
};

audio_fx_api_v2_t* move_audio_fx_init_v2(const host_api_v1_t *host) {
    (void)host;
    return &g_api;
}
```

## module.json for an FX module

```json
{
  "id": "myfx",
  "name": "MyFX",
  "capabilities": {
    "audio_in": true,
    "audio_out": true,
    "midi_in": false,
    "midi_out": false,
    "chainable": true,
    "component_type": "audio_fx"
  }
}
```

`src/modules/index.json` needs the entry too: `{ "id": "myfx", "name": "MyFX", "kind": "audio_fx" }`.

## Offline render harness for FX

`tools/render_wav.c` is sound-generator-only today; it calls `move_plugin_init_v2`. An FX harness needs a separate entry point that:

1. Loads an input WAV (or generates a test signal: sine, noise, sweep).
2. Calls `move_audio_fx_init_v2` to get the FX api.
3. Streams 128-frame blocks through `process_block`.
4. Writes the processed audio out.

This harness is not implemented yet; add it when the first FX module lands.

## Web UI / WASM

The current worklet (`web/module-worklet.js`) is output-only — it calls `mf_render(frames)` and reads the module's pre-allocated L/R float buffers. To audition FX in the browser, the WASM adapter would need to expose `mf_in_left_ptr` / `mf_in_right_ptr` exports and the worklet would need to copy `inputs[0]` into those buffers before calling render. Defer until needed.

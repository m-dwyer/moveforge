# Architecture

A one-page mental model of how the layers fit together. CLAUDE.md is the
procedural reference (commands, conventions, how to add a param); this doc
is the conceptual map.

## Stack

```
┌──────────────────────────────────────────────────────────────┐
│ Browser harness (web/)                                       │
│   React + Zustand + Tailwind + shadcn (Vite dev server)      │
│   Replicates Move's track/chain UX, drives the audio engine  │
└──────────────────────────┬───────────────────────────────────┘
                           │ AudioWorkletNode per slot
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Audio engine (web/src/audio-engine.ts + module-worklet.js)   │
│   AudioContext + one worklet per active chain slot           │
│   Loads compiled WASM into each worklet                      │
└──────────────────────────┬───────────────────────────────────┘
                           │ WASM module per <module-id> per kind
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Compiled artifact (web/wasm/<id>.wasm or Move .schw)         │
│   Schwung wrapper (sound_generator / audio_fx / midi_fx)     │
└──────────────────────────┬───────────────────────────────────┘
                           │ same C, two build targets
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ Shared C DSP core (src/modules/<id>/dsp/<id>_core.{h,c})     │
│   Pure DSP. No platform, no I/O. Tested headlessly.          │
└──────────────────────────────────────────────────────────────┘

       Single source of truth for metadata + params:
       src/modules/<id>/module.json
       Drives codegen (*_params.gen.inc), UI (browser + on-device),
       and validation.
```

## Layers, top to bottom

### Browser harness — `web/`

- **Entry:** `web/index.html` → `web/src/main.tsx` → `web/src/AppRoot.tsx`.
- **State:** `web/src/store.ts` (Zustand + Immer). One central store for tracks,
  chains, slot metadata, top-level params, presets, pad config, step harness.
  Subscribers in `AppRoot.tsx` sync chain shape to the audio engine and bridge
  the Vite HMR event `moveforge:wasm-rebuilt` to a `window` CustomEvent.
- **UI components:** `web/src/components/` — `Panel`, `Chain`, `ChainSlot`,
  `Controls`, `Presets`, `TrackBar`, `PadConfig`, `PadGrid`, `StepHarness`,
  plus shadcn primitives under `components/ui/`.
- **Note mapping:** `web/src/lib/pads.ts` (root/scale/octave → MIDI note).
- **Build:** Vite (`vite.config.ts`). React HMR is built in. A custom plugin
  watches `src/modules/**` and `src/host/**`, rebuilds the affected `.wasm`,
  then fires a custom HMR event so the page hot-swaps the slot without a
  full reload.

### Audio engine — `web/src/audio.ts` + `audio-engine.ts` + `web/module-worklet.js`

- `audio.ts` is the React-facing bridge: `noteOn`/`noteOff`/`syncChain`/
  `sendParamToSlot`/`reloadModuleWasm`. Boots the AudioContext lazily on the
  first user gesture (browser autoplay policy).
- `audio-engine.ts` owns the AudioContext and a `Map<slotId, AudioWorkletNode>`.
  Builds the audio graph by connecting `sound_generator` and `audio_fx` slots
  in series; `midi_fx` slots route to a silent sink so their worklet keeps
  ticking but doesn't emit audio. midi_fx → sound routing happens via main
  thread relay: midi_fx worklet posts `midiOut`, audio.ts forwards to the
  sound slot's `midiIn`.
- `module-worklet.js` is the generic AudioWorklet processor. It loads WASM
  bytes sent over its message port, detects which Schwung ABI the module
  exports (sg / fx / midi_fx), and dispatches messages accordingly.

### Compiled artifact

- **Browser:** one `web/wasm/<id>.wasm` per module, linked against the
  appropriate glue in `src/host/schwung_wasm_glue_{sg,fx}.c` or
  `src/host/midi_fx_wasm_glue.c`.
- **Device:** `dist/<id>/` + `dist/<id>-module.tar.gz`, an aarch64 build for
  Move via `make move` (uses the same C, different target).
- Same `.c` files feed both targets; only the linked glue + target arch differ.

### Schwung wrapper — `src/modules/<id>/dsp/<id>.c`

Translates Schwung lifecycle, parameter, MIDI, and audio block calls into
calls on the core. There are three flavours of wrapper because Schwung exposes
three component types, each with its own ABI:

| component_type   | ABI header                  | init symbol               | I/O shape                  |
|------------------|-----------------------------|---------------------------|----------------------------|
| sound_generator  | `src/host/plugin_api_v1.h`  | `move_plugin_init_v2`     | MIDI in → stereo audio out |
| audio_fx         | `src/host/audio_fx_api_v2.h`| `move_audio_fx_init_v2`   | stereo in → stereo out     |
| midi_fx          | `src/host/midi_fx_api_v1.h` | `move_midi_fx_init`       | MIDI in → MIDI out         |

### Shared C DSP core — `src/modules/<id>/dsp/<id>_core.{h,c}`

The source of truth for musical behaviour. Headless, dependency-light,
C11-compatible. Holds a state struct with one `float` field per param key.
Process entry point is `<module>_process_float(core, in_l, in_r, out_l, out_r, frames)`
for audio modules; midi_fx uses `<module>_process_midi` + `<module>_tick`.

Tested via `tests/test_<id>_core.c` against the same float pipeline the
wrapper drives — no audio APIs in the test suite.

## Cross-cutting: `module.json` is the source of truth

For every module, **one file** declares everything else needs to know:

- Identity: `id`, `name`, abbrev, `component_type`, `api_version`
- Parameter schema: `capabilities.ui_hierarchy.levels.root.params` —
  `{ key, name, type, min, max, default, step }` per param

From this one file, `scripts/gen-params.ts` emits
`src/modules/<id>/dsp/<id>_params.gen.inc` which gives the C core a typed
enum, `<module>_set_param` (with clamps), `<module>_get_param`, and
`<module>_apply_defaults`. The same `params` block drives:

- Move's on-device chain host (when the .schw is loaded)
- The browser harness's param sliders (via `loadModuleMetadata` →
  `topLevelParams` / `slotMeta`)
- Validation (`pnpm run validate` — checks that the gen.inc is in sync and
  that presets reference only declared keys)

`presets.json` sits alongside and is similarly cross-consumed: render-suite
fixtures + browser preset row + on-device preset list all read it.

## Two execution paths

### Browser audition

1. User runs `mise run serve`. Vite starts at `localhost:8765/web/`.
2. `audio-engine.ts` lazy-boots an `AudioContext` on first pad press.
3. For each populated chain slot, an `AudioWorkletNode` instantiates
   `module-worklet.js`, which loads `web/wasm/<id>.wasm` and exposes a port
   for `noteOn`/`noteOff`/`param`/`midiIn` messages.
4. Edits to `src/modules/<id>/dsp/*.c` trigger the Vite WASM plugin →
   `./scripts/build-wasm.sh` → `engine.reloadSlot(slotId)`. No page reload.

### Move device deploy

1. `mise run move` builds the aarch64 module (`dist/<id>/`).
2. `./scripts/install-to-move.sh` copies to `ableton@move.local:/data/UserData/schwung/modules/...`
3. Move's Schwung runtime loads the same wrapper + core via the
   `plugin_api_v2_t` / `audio_fx_api_v2_t` / `midi_fx_api_v1_t` ABI.
4. UI on the OLED comes from `src/modules/<id>/ui.js` (solo mode) and
   `ui_chain.js` (chain mode); both read the same param keys.

The browser harness is a fidelity stand-in: it runs the same `<module>.c`
wrapper code through the same Schwung ABI shape, with int16 audio conversion
matched to the device. What you hear in the browser is close to what plays
on Move, modulo block-rate jitter from Web Audio.

## Where to look for specific topics

- **Adding a param / adding a module:** `CLAUDE.md` ("When adding a parameter",
  "Adding a new module").
- **Common commands:** `CLAUDE.md` "Common Commands" section.
- **Schwung audio_fx wrapper template details:** `docs/audio-fx-template.md`.
- **Why the browser runs the Schwung-wrapped WASM (vs. a leaner ABI):**
  `docs/browser-wrapper-modes.md`.
- **Move device workflow:** `docs/schwung-device-workflow.md`.
- **Move hardware emulator implementation notes:** `docs/move-emulator-toolchain.md`.
- **Schwung UI conventions:** `docs/schwung-ui-patterns.md`.
- **Roadmap / open experiments:** `docs/roadmap.md`,
  `docs/next-schwung-experiments.md`.
- **Browser Playwright test rewrite plan:** `docs/emulator-test-rewrite.md`.

## What this doc deliberately doesn't cover

- Step-by-step procedures (CLAUDE.md).
- DSP internals of any specific module (read the `_core.c`).
- The Move device's internal Schwung runtime (closed-source, third-party).
- Specific commit-by-commit history of the React migration (git log).

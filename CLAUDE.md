# CLAUDE.md

Guidance for AI coding agents working in this repository.

> For module-authoring workflows specifically (creating new modules, adding params, the Faust vs plain-C decision, the dev loop), read `skills/schwung-dsp-development/SKILL.md` — it's the canonical workflow guide and also doubles as an installable agent skill (run `scripts/install-skill.sh` to add it to your personal Claude/Codex skills).

## Project Purpose

This repo is a local development harness for building custom Schwung modules for Ableton Move across all three component kinds: sound generators (synth voices), audio FX, and MIDI FX.

Included modules:

| id | kind | authoring | what it is |
|---|---|---|---|
| `westfold` | sound_generator | plain C | West Coast voice: dual oscillator FM, wavefolder, low-pass gate |
| `dustline` | sound_generator | plain C | Subtractive/noise voice: oscillator blend, resonant filter, drive |
| `faust_voice` | sound_generator | Faust | Mono sawtooth + ADSR + resonant LPF + tanh saturation |
| `trail` | audio_fx | plain C | Stereo feedback delay |
| `faust_drive` | audio_fx | Faust | Drive/tone/mix saturator |
| `arpy` | midi_fx | plain C | Arpeggiator with clock sync |

DSP can be authored in plain C or in Faust (`.dsp` source compiled to C and checked in). Either path uses the same Schwung wrapper, the same offline render harness, and the same WASM build. The full authoring workflow lives in `skills/schwung-dsp-development/SKILL.md` (also installable as an agent skill via `scripts/install-skill.sh`).

Each module has:

- a shared C DSP core (or a Faust `.dsp` source + adapter)
- a Schwung plugin wrapper for Move deployment (also compiled to WASM for browser auditioning via `src/host/schwung_wasm_glue_{sg,fx}.c` or `src/host/midi_fx_wasm_glue.c`)
- an offline WAV/trace harness and render suite
- a local web UI that mocks key Move interaction surfaces

Schwung is unofficial and device deployment should be treated as experimental. Prefer local render, host, and WASM checks before copying anything to Move.

## Architecture

The main rule: keep musical DSP behavior in the shared core.

- `src/modules/<module-id>/` is a self-contained module directory.
- `src/modules/<module-id>/dsp/<module-id>_core.h` declares the **public API contract** — `<module>_init`, `<module>_process_float`, `<module>_set_param`, etc. This shape is identical for plain-C and Faust modules; the wrapper and tests can't tell which is in use.
- For **plain C** modules, `<module-id>_core.c` implements that contract directly — it holds the DSP state struct, MIDI handling, and the per-sample processing loop. The processing entry point is `<module>_process_float(core, in_left, in_right, out_left, out_right, frames)` — sound generators ignore the input pointers (callers pass `NULL`); audio FX modules read from them. midi_fx modules use `<module>_process_midi` + `<module>_tick` instead. See `docs/audio-fx-template.md` for the FX wrapper pattern.
- For **Faust** modules, `<module-id>.dsp` is the canonical DSP source. `mise run gen-faust` invokes the Faust compiler to produce `<module-id>_faust.c` (checked in so the project builds without Faust installed). `<module-id>_adapter.c` implements the moveforge API contract by bridging to the generated Faust DSP — captures parameter zone addresses via `buildUserInterface`, drives `compute()` each block. See `src/host/faust_adapter.h` for shared UIGlue boilerplate and `src/host/faust_module_arch.c.in` for the architecture template gen-faust passes to Faust. Build scripts detect by presence of `<id>.dsp` and compile `_adapter.c` instead of `_core.c` — no flag, no config.
- `src/modules/<module-id>/dsp/<module-id>_params.gen.inc` is **generated** from `module.json` by `scripts/gen-params.ts`. It defines the param enum, `<module>_param_id`, `<module>_set_param` (with clamps from min/max), `<module>_get_param`, and `<module>_apply_defaults`. Included from `<module>_core.c` (plain C) or `<module>_adapter.c` (Faust); wrappers and tests use the public functions (string keys), not the enum. **Do not edit by hand** — re-run `mise run gen-params` after editing `module.json`. For plain C, the state struct must have one `float` field per param key; for Faust, the adapter holds them as fields plus captured Faust zone pointers.
- `src/modules/<module-id>/dsp/<module-id>.c` is the Schwung plugin adapter. It translates Schwung lifecycle calls, string parameters, MIDI bytes, and audio/MIDI block I/O into calls on the core. Different wrappers for each component_type (sound_generator → `plugin_api_v2_t` / `move_plugin_init_v2`; audio_fx → `audio_fx_api_v2_t` / `move_audio_fx_init_v2`; midi_fx → `midi_fx_api_v1_t` / `move_midi_fx_init`).
- `src/host/plugin_api_v1.h`, `src/host/audio_fx_api_v2.h`, `src/host/midi_fx_api_v1.h` are local references of the Schwung ABIs.
- Browser WASM builds compile the same `<module-id>.c` Schwung wrapper used on device, linked against `src/host/schwung_wasm_glue_sg.c` (sound_generator), `schwung_wasm_glue_fx.c` (audio_fx), or `midi_fx_wasm_glue.c` (midi_fx). One `web/wasm/<id>.wasm` per module. Audio goes through the same int16 conversion as on Move, so what you hear in the browser is what plays on device.
- `tools/render_wav.c` is the offline host harness for sound generators. It loads the Schwung wrapper directly, sends deterministic MIDI/parameter sequences, and writes WAV fixtures.
- `tools/render_fx.c` is the offline host harness for audio FX. It generates a test signal (sweep/noise/impulse/silence) or reads an input WAV, streams it through `move_audio_fx_init_v2` in 128-frame blocks, and writes the processed WAV.
- `tools/trace_midi_fx.c` is the offline host harness for MIDI FX. It runs a deterministic note/tick sequence through `move_midi_fx_init` and writes a stable text trace of every event in/out. Compared byte-for-byte against goldens (no tolerance) since MIDI is discrete.
- `tools/render_diff.py` produces a 3-panel diagnostic PNG (golden + current waveform overlay, normalized diff waveform, golden vs current spectrum overlay) when `check-renders` detects WAV drift. Bless also stores per-suite WAVs under `goldens/<id>/` so future diffs have audio to compare.
- `src/modules/<module-id>/module.json` is the **single source of truth** for the module's metadata (id, name, abbrev 3-6 chars, capabilities, component_type, api_version) AND its parameter schema. The `capabilities.ui_hierarchy.levels.root.params` array (each entry: `key`, `name`, `type`, `min`, `max`, `default`, `step`) drives both Move's chain host and the codegen above.
- `src/modules/<module-id>/presets.json` drives local preset buttons and render-suite clips. Keys must be subset of params declared in `module.json`; values must be within `[min, max]`.
- `src/modules/<module-id>/ui.js` is the on-device Schwung UI entry point (solo mode).
- `src/modules/<module-id>/ui_chain.js` is the Signal Chain UI shim (chain mode). Required so the module renders correctly when placed in a chain slot on device. Must export `globalThis.chain_ui = { init, tick, onMidiMessageInternal, onMidiMessageExternal }` and must NOT override `globalThis.init` or `globalThis.tick`.
- `src/modules/index.json` is the browser-visible module discovery list.
- `web/` contains the local browser UI. It reads `src/modules/<module-id>/module.json`, `src/modules/<module-id>/presets.json`, and `web/wasm/<module-id>.wasm`. Param metadata is read from the same `ui_hierarchy.levels.root.params` block.

When adding a parameter:

1. Edit `src/modules/<module-id>/module.json` (add to `capabilities.ui_hierarchy.levels.root.params`)
2. **Plain C**: add a matching `float <key>;` field to the state struct in `<module-id>_core.h`. **Faust**: add a matching `hslider("<key>", default, min, max, step)` declaration to `<module-id>.dsp` — the adapter captures it by label via `buildUserInterface`.
3. Run `mise run gen-params` (regenerates the `.gen.inc`). **Faust only**: also run `mise run gen-faust` (regenerates `<module-id>_faust.c`).
4. Use the new param in the DSP — `<module-id>_core.c` (plain C) or the `.dsp` body (Faust).
5. Add the key to every preset in `src/modules/<module-id>/presets.json`.
6. Focused tests in `tests/test_<module-id>_core.c`.
7. Run `mise run validate` (re-checks both `gen-params` and `gen-faust` drift).

Adding a new module: `pnpm run new-module -- --id <id> --kind sound_generator|audio_fx|midi_fx` scaffolds a module from the matching template directory, substitutes MODULE_ID/UPPER/NAME/ABBREV, runs gen-params, and registers in `src/modules/index.json`. Faust is the default authoring path for `sound_generator` and `audio_fx`, using `src/modules/_template_faust_sound_generator/` or `src/modules/_template_faust_audio_fx/`, and the scaffolder also regenerates checked-in Faust C. Use `--dsp c` for synths or audio FX only when Faust is awkward, too opaque, too slow, or the module needs unusual hand-written state. MIDI FX modules are always plain C.

## Common Commands

Use `mise` tasks when available; they wrap the `Makefile`.

```bash
mise run setup   # create .venv and install plotting dependencies
mise run test    # compile and run DSP core smoke tests
mise run gen-params # regenerate <module-id>_params.gen.inc from module.json
mise run gen-faust  # regenerate <module-id>_faust.c from <module-id>.dsp (Faust modules only)
mise run validate # validate module metadata + check gen-params and gen-faust drift
mise run render  # render renders/<module-id>-demo.wav (sound_generator only)
mise run suite   # render preset WAVs under renders/<module-id>-suite/
mise run plot    # render suite and generate waveform/spectrum PNGs
mise run host    # build local host-only shared library
mise run wasm    # build web/wasm/<module-id>.wasm with Emscripten Docker image
mise run serve   # run Vite dev server at http://localhost:8765/
mise run dev     # same as serve; Vite handles React HMR + a custom plugin watches src/modules/* and rebuilds the relevant WASM, then hot-swaps that slot in the audio engine without a page reload
mise run web     # build WASM then serve the web UI
mise run web-test # Vitest browser-mode component tests for the React UI (audio mocked)
mise run move    # build aarch64 Move-target module package
mise run move-health # check SSH, Schwung paths, disk, logs, and installed module files
mise run move-logs # tail /data/UserData/schwung/debug.log
mise run move-cache # dry-run transient Schwung/Move runtime cache clearing
mise run move-restart # ask Schwung's restart helper to restart Move
mise run move-screen # capture the Move/Schwung screen endpoint
mise run check   # run non-device checks: validate, test, suite, plot, host
mise run check-all # run non-device checks for all included modules
```

Native/device `make` targets exist for `make test`, `make render`, `make suite`, `make plot`, `make host`, `make wasm`, `make move`, `make move-health`, `make move-logs`, `make move-cache`, `make move-restart`, `make move-screen`, `make check`, `make check-all`, and `make clean`. Node, TypeScript, and browser tasks live in `package.json` (`pnpm run validate`, `pnpm run serve`, `pnpm test`, `pnpm run typecheck`). Keep Move shell operations out of `package.json`; use direct scripts, `make`, or `mise` tasks instead. Module-aware commands default to `MODULE_ID=westfold`; set `MODULE_ID=<id>` to target any of the other modules (e.g. `MODULE_ID=faust_drive mise run suite`, `MODULE_ID=arpy mise run wasm`).

The web UI is served at:

```text
http://localhost:8765/
```

The browser UI is React + Vite + Tailwind + shadcn (`web/src/*.tsx`, `web/src/components/*`). State is in a Zustand store (`web/src/store.ts`); the audio engine bridge is `web/src/audio.ts` and wraps `web/src/audio-engine.ts` unchanged.

## Build And Deploy Flow

Fast local loop:

1. Edit the DSP source (`<module-id>_core.c` for plain C, `<module-id>.dsp` for Faust).
2. Faust only: `MODULE_ID=<id> mise run gen-faust`.
3. Run `mise run test`.
4. Run `MODULE_ID=<id> mise run suite`.
5. Run `MODULE_ID=<id> mise run plot` and inspect `renders/plots/<id>/`.
6. Listen to `renders/<id>-demo.wav` and `renders/<id>-suite/*.wav`.
7. Run `MODULE_ID=<id> mise run wasm` and use the browser UI for interactive checks.
8. `MODULE_ID=<id> pnpm run bless-renders` once the change is intentional.

Move package loop:

```bash
mise run move
```

This writes:

```text
dist/<module-id>/
dist/<module-id>-module.tar.gz
```

Device install loop:

```bash
./scripts/install-to-move.sh
```

By default this builds first, then copies `dist/<module-id>/` to `ableton@move.local:/data/UserData/schwung/modules/<kind>/` where `<kind>` is inferred from `module.json` (`sound_generators`, `audio_fx`, or `midi_fx`).

Override the target with `MOVE_HOST`, for example:

```bash
MOVE_HOST=ableton@192.168.1.42 ./scripts/install-to-move.sh
```

## Development Conventions

- Keep C code C11-compatible and dependency-light.
- Preserve 44.1 kHz, 128-frame block assumptions unless changing every adapter and test harness deliberately.
- Keep output finite and normalized. Core tests already check this; add more assertions when changing gain staging, feedback, filters, or envelopes.
- Prefer deterministic offline renders over subjective code review when judging sound changes.
- Avoid duplicating DSP logic in wrappers, web code, or render tools.
- Keep generated outputs out of git: `build/`, `dist/`, `renders/`, `web/wasm/*.wasm`, and `.venv/` are ignored.
- Do not deploy `dist-host/` to Move. It is only for local host experiments.

## Suggested Improvements

Prioritized improvements to make synth and FX iteration faster and safer:

1. Generate `PARAM_IDS` for `web/module-worklet.js` from the selected module's `module.json` to remove the remaining JS fallback mapping.
2. Add a browser capture/export path that records a short WAV from the current WASM state and stores it beside the offline suite for A/B comparison.
3. Add a hardware screenshot/OLED calibration path against the real 128x64 display.
4. Add a small preset morph/randomize tool in the web UI to explore parameter spaces quickly, with bounded randomization from `module.json` ranges.
5. Add MIDI learn or configurable CC mapping in the web UI, instead of hard-coding CC 20-27.
6. Add clang-format and a formatting task to keep C changes mechanical and reviewable.
7. Add GitHub Actions or a local pre-push command for `mise run check`, leaving Move deploy as an explicit local-only step.
8. Generate Faust adapter boilerplate from `module.json` so template adapters do not hard-code param counts.

For the next repo change, the highest-leverage item is probably generated parameter bindings (#1). The current validator catches drift across C, module JSON, and presets; generating the worklet mapping from `module.json` would remove the remaining browser-side duplication entirely.

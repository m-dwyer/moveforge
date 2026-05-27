# CLAUDE.md

Guidance for AI coding agents working in this repository.

## Project Purpose

This repo is a local development harness for building custom Schwung modules for Ableton Move. It currently contains two sound-generator modules:

- `westfold`: compact West Coast voice with FM, wavefolding, and low-pass gate behavior
- `dustline`: compact subtractive/noise voice with oscillator blend, resonant filter, and drive

Each module has:

- a shared C DSP core
- a Schwung plugin wrapper for Move deployment (also compiled to WASM for browser auditioning via `src/host/schwung_wasm_glue_{sg,fx}.c`)
- an offline WAV renderer and render suite
- a local web UI that mocks key Move interaction surfaces

Schwung is unofficial and device deployment should be treated as experimental. Prefer local render, host, and WASM checks before copying anything to Move.

## Architecture

The main rule: keep musical DSP behavior in the shared core.

- `src/modules/<module-id>/` is a self-contained module directory.
- `src/modules/<module-id>/dsp/<module-id>_core.c` and `src/modules/<module-id>/dsp/<module-id>_core.h` are the source of truth for DSP behavior, state, MIDI handling, and processing. The processing entry point is `<module>_process_float(core, in_left, in_right, out_left, out_right, frames)` — sound generators ignore the input pointers (callers pass `NULL`); audio FX modules read from them. midi_fx modules use `<module>_process_midi` + `<module>_tick` instead. See `docs/audio-fx-template.md` for the FX wrapper pattern.
- `src/modules/<module-id>/dsp/<module-id>_params.gen.inc` is **generated** from `module.json` by `scripts/gen-params.ts`. It defines the param enum, `<module>_param_id`, `<module>_set_param` (with clamps from min/max), `<module>_get_param`, and `<module>_apply_defaults`. Included from `<module>_core.c` only; wrappers and tests use the public functions (string keys), not the enum. **Do not edit by hand** — re-run `mise run gen-params` after editing `module.json`. The state struct must have one `float` field per param key.
- `src/modules/<module-id>/dsp/<module-id>.c` is the Schwung plugin adapter. It translates Schwung lifecycle calls, string parameters, MIDI bytes, and audio/MIDI block I/O into calls on the core. Different wrappers for each component_type (sound_generator → `plugin_api_v2_t` / `move_plugin_init_v2`; audio_fx → `audio_fx_api_v2_t` / `move_audio_fx_init_v2`; midi_fx → `midi_fx_api_v1_t` / `move_midi_fx_init`).
- `src/host/plugin_api_v1.h`, `src/host/audio_fx_api_v2.h`, `src/host/midi_fx_api_v1.h` are local references of the Schwung ABIs.
- Browser WASM builds compile the same `<module-id>.c` Schwung wrapper used on device, linked against `src/host/schwung_wasm_glue_sg.c` (sound_generator) or `schwung_wasm_glue_fx.c` (audio_fx). One `web/wasm/<id>.wasm` per module. Audio goes through the same int16 conversion as on Move, so what you hear in the browser is what plays on device. midi_fx has no browser path yet.
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
2. Add a matching `float <key>;` field to the state struct in `<module-id>_core.h`
3. Run `mise run gen-params` (regenerates the `.gen.inc`)
4. Use the new param in `<module-id>_core.c` (the DSP)
5. Add the key to every preset in `src/modules/<module-id>/presets.json`
6. Focused tests in `tests/test_<module-id>_core.c`
7. Run `mise run validate` (also re-checks the gen.inc is in sync)

Adding a new module: `pnpm run new-module -- --id <id> --kind sound_generator|audio_fx|midi_fx`. Scaffolder copies the matching `_template*` directory, substitutes MODULE_ID/UPPER/NAME/ABBREV, runs gen-params, and registers in `src/modules/index.json`.

## Common Commands

Use `mise` tasks when available; they wrap the `Makefile`.

```bash
mise run setup   # create .venv and install plotting dependencies
mise run test    # compile and run DSP core smoke tests
mise run gen-params # regenerate <module-id>_params.gen.inc from module.json
mise run validate # validate module metadata + check gen.inc is in sync
mise run render  # render renders/<module-id>-demo.wav (sound_generator only)
mise run suite   # render preset WAVs under renders/<module-id>-suite/
mise run plot    # render suite and generate waveform/spectrum PNGs
mise run host    # build local host-only shared library
mise run wasm    # build web/wasm/<module-id>.wasm with Emscripten Docker image
mise run serve   # run Vite dev server at http://localhost:8765/
mise run dev     # same as serve; Vite handles React HMR + a custom plugin watches src/modules/* and rebuilds the relevant WASM, then hot-swaps that slot in the audio engine without a page reload
mise run web     # build WASM then serve the web UI
mise run web-test # Playwright tests against the React web UI (audio mocked)
mise run move    # build aarch64 Move-target module package
mise run move-health # check SSH, Schwung paths, disk, logs, and installed module files
mise run move-logs # tail /data/UserData/schwung/debug.log
mise run move-cache # dry-run transient Schwung/Move runtime cache clearing
mise run move-restart # ask Schwung's restart helper to restart Move
mise run move-screen # capture the Move/Schwung screen endpoint
mise run check   # run non-device checks: validate, test, suite, plot, host
mise run check-all # run non-device checks for all included modules
```

Native/device `make` targets exist for `make test`, `make render`, `make suite`, `make plot`, `make host`, `make wasm`, `make move`, `make move-health`, `make move-logs`, `make move-cache`, `make move-restart`, `make move-screen`, `make check`, `make check-all`, and `make clean`. Node, TypeScript, and browser tasks live in `package.json` (`pnpm run validate`, `pnpm run serve`, `pnpm test`, `pnpm run typecheck`). Keep Move shell operations out of `package.json`; use direct scripts, `make`, or `mise` tasks instead. Module-aware commands default to `MODULE_ID=westfold`; use `MODULE_ID=dustline make suite` or `MODULE_ID=dustline mise run wasm` for Dustline.

The web UI is served at:

```text
http://localhost:8765/
```

The browser UI is React + Vite + Tailwind + shadcn (`web/src/*.tsx`, `web/src/components/*`). State is in a Zustand store (`web/src/store.ts`); the audio engine bridge is `web/src/audio.ts` and wraps `web/src/audio-engine.ts` unchanged.

## Build And Deploy Flow

Fast local loop:

1. Edit `src/modules/<module-id>/dsp/<module-id>_core.c`.
2. Run `mise run test`.
3. Run `mise run suite`.
4. Listen to `renders/<module-id>-demo.wav` and `renders/<module-id>-suite/*.wav`.
5. Run `mise run wasm` and use the browser UI for interactive checks.

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

By default this builds first, then copies `dist/<module-id>/` to:

```text
ableton@move.local:/data/UserData/schwung/modules/sound_generators/
```

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

1. Generate `PARAM_IDS` for `web/module-worklet.js` from the selected module's `params.json` manifest to remove the remaining JS fallback mapping.
2. Add render metrics in CI/local checks: peak, RMS, DC offset, silence detection, clipped-sample count, and per-preset JSON summaries.
3. Add golden render comparison with tolerance, so DSP changes can intentionally update fixtures while accidental regressions are obvious.
4. Add a browser capture/export path that records a short WAV from the current WASM state and stores it beside the offline suite for A/B comparison.
5. Add an FX render harness for processing fixture WAVs through `move_audio_fx_init_v2`.
6. Add browser/WASM support for audio FX inputs and output comparison.
7. Add a hardware screenshot/OLED calibration path against the real 128x64 display.
8. Add a small preset morph/randomize tool in the web UI to explore parameter spaces quickly, with bounded randomization from `module.json` ranges.
9. Add MIDI learn or configurable CC mapping in the web UI, instead of hard-coding CC 20-27.
10. Add clang-format and a formatting task to keep C changes mechanical and reviewable.
11. Add GitHub Actions or a local pre-push command for `mise run check`, leaving Move deploy as an explicit local-only step.

For the next repo change, the highest-leverage item is probably generated parameter bindings. The current validator catches drift across C, module JSON, and presets; generating the worklet mapping from `params.json` would remove the remaining browser-side duplication entirely.

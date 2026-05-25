# CLAUDE.md

Guidance for AI coding agents working in this repository.

## Project Purpose

This repo is a local development harness for building custom Schwung modules for Ableton Move. It currently contains two sound-generator modules:

- `westfold`: compact West Coast voice with FM, wavefolding, and low-pass gate behavior
- `dustline`: compact subtractive/noise voice with oscillator blend, resonant filter, and drive

Each module has:

- a shared C DSP core
- a Schwung plugin wrapper for Move deployment
- a WASM wrapper for browser-based auditioning
- an offline WAV renderer and render suite
- a local web UI that mocks key Move interaction surfaces

Schwung is unofficial and device deployment should be treated as experimental. Prefer local render, host, and WASM checks before copying anything to Move.

## Architecture

The main rule: keep musical DSP behavior in the shared core.

- `src/modules/<module-id>/` is a self-contained module directory.
- `src/modules/<module-id>/dsp/<module-id>_core.c` and `src/modules/<module-id>/dsp/<module-id>_core.h` are the source of truth for synthesis behavior, parameter IDs, clamping, MIDI note state, pitch bend, and float processing. The processing entry point is `<module>_process_float(core, in_left, in_right, out_left, out_right, frames)` — sound generators ignore the input pointers (callers pass `NULL`); audio FX modules read from them. See `docs/audio-fx-template.md` for the FX wrapper pattern.
- `src/modules/<module-id>/dsp/<module-id>.c` is the Schwung plugin adapter. It translates Schwung lifecycle calls, string parameters, MIDI bytes, and `int16_t` block output into calls on the core.
- `src/modules/<module-id>/dsp/<module-id>_wasm.c` is the browser/WASM adapter. It exports the shared `mf_*` C ABI for the AudioWorklet.
- `tools/render_wav.c` is the offline host harness. It loads the Schwung wrapper directly, sends deterministic MIDI/parameter sequences, and writes WAV fixtures.
- `src/modules/<module-id>/module.json` is Schwung metadata and Move-facing module parameter schema.
- `src/modules/<module-id>/params.json` is the local source of truth for that module's parameter IDs, labels, ranges, defaults, and ordering.
- `src/modules/<module-id>/presets.json` drives local preset buttons and render-suite clips.
- `src/modules/<module-id>/ui.js` is the on-device Schwung UI entry point.
- `src/modules/index.json` is the browser-visible module discovery list.
- `web/` contains the local browser UI. It reads `src/modules/<module-id>/module.json`, `src/modules/<module-id>/presets.json`, and `web/wasm/<module-id>.wasm`.

When adding a parameter, update all of these surfaces together:

1. `src/modules/<module-id>/dsp/<module-id>_core.h` enum and state
2. `src/modules/<module-id>/dsp/<module-id>_core.c` lookup, clamp, defaults, and render behavior
3. `src/modules/<module-id>/module.json`
4. `src/modules/<module-id>/presets.json`
5. `src/modules/<module-id>/params.json`
6. focused tests in `tests/test_<module-id>_core.c`
7. run `mise run validate`

## Common Commands

Use `mise` tasks when available; they wrap the `Makefile`.

```bash
mise run setup   # create .venv and install plotting dependencies
mise run test    # compile and run DSP core smoke tests
mise run validate # validate module-scoped parameter metadata and mappings
mise run render  # render renders/<module-id>-demo.wav
mise run suite   # render preset WAVs under renders/<module-id>-suite/
mise run plot    # render suite and generate waveform/spectrum PNGs
mise run host    # build local host-only shared library
mise run wasm    # build web/wasm/<module-id>.wasm with Emscripten Docker image
mise run serve   # serve repo at http://localhost:8765/
mise run web     # build WASM then serve the web UI
mise run emulator-test # run browser emulator smoke tests
mise run move    # build aarch64 Move-target module package
mise run check   # run non-device checks: validate, test, suite, plot, host
mise run check-all # run non-device checks for all included modules
```

Native/device `make` targets exist for `make test`, `make render`, `make suite`, `make plot`, `make host`, `make wasm`, `make move`, `make check`, `make check-all`, and `make clean`. Node, TypeScript, and browser tasks live in `package.json` (`pnpm run validate`, `pnpm run serve`, `pnpm run emulator-test`, `pnpm run typecheck`). Module-aware commands default to `MODULE_ID=westfold`; use `MODULE_ID=dustline make suite` or `MODULE_ID=dustline mise run wasm` for Dustline.

The web UI is served at:

```text
http://localhost:8765/web/
http://localhost:8765/web/?module=dustline
```

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
5. Add a Move health-check script that verifies SSH, Schwung module path, free disk space, target architecture, and installed module version before deploy.
6. Add `scripts/tail-move-log.sh` or equivalent if Schwung/Move logs are available over SSH, so deploy failures are visible without manual device digging.
7. Add a module scaffolder for synths and FX now that two sound generators exist.
8. Add an FX-module template once the sound-generator flow is stable, with audio-in/audio-out capabilities and a dedicated local render harness for processing fixture WAVs.
9. Add a small preset morph/randomize tool in the web UI to explore parameter spaces quickly, with bounded randomization from `module.json` ranges.
10. Add MIDI learn or configurable CC mapping in the web UI, instead of hard-coding CC 20-27.
11. Add clang-format and a formatting task to keep C changes mechanical and reviewable.
12. Add GitHub Actions or a local pre-push command for `mise run check`, leaving Move deploy as an explicit local-only step.

For the next repo change, the highest-leverage item is probably generated parameter bindings. The current validator catches drift across C, module JSON, and presets; generating the worklet mapping from `params.json` would remove the remaining browser-side duplication entirely.

# CLAUDE.md

Guidance for AI coding agents working in this repository.

## Project Purpose

This repo is a local development harness for building custom Schwung modules for Ableton Move. It currently contains `westfold`, a compact West Coast style sound generator with:

- a shared C DSP core
- a Schwung plugin wrapper for Move deployment
- a WASM wrapper for browser-based auditioning
- an offline WAV renderer and render suite
- a local web UI that mocks key Move interaction surfaces

Schwung is unofficial and device deployment should be treated as experimental. Prefer local render, host, and WASM checks before copying anything to Move.

## Architecture

The main rule: keep musical DSP behavior in the shared core.

- `src/dsp/westfold_core.c` and `src/dsp/westfold_core.h` are the source of truth for synthesis behavior, parameter IDs, clamping, MIDI note state, pitch bend, and float rendering.
- `src/dsp/westfold.c` is the Schwung plugin adapter. It translates Schwung lifecycle calls, string parameters, MIDI bytes, and `int16_t` block output into calls on the core.
- `src/dsp/westfold_wasm.c` is the browser/WASM adapter. It exports a minimal C ABI for the AudioWorklet.
- `tools/render_wav.c` is the offline host harness. It loads the Schwung wrapper directly, sends deterministic MIDI/parameter sequences, and writes WAV fixtures.
- `src/module.json` is Schwung metadata and UI/parameter schema.
- `src/presets.json` drives local preset buttons and render-suite clips.
- `src/ui.js` is the on-device Schwung UI entry point.
- `web/` contains the local browser UI. It reads `src/module.json`, `src/presets.json`, and `web/wasm/westfold.wasm`.

When adding a parameter, update all of these surfaces together:

1. `src/dsp/westfold_core.h` enum and state
2. `src/dsp/westfold_core.c` lookup, clamp, defaults, and render behavior
3. `src/module.json`
4. `src/presets.json`
5. `web/westfold-worklet.js` `PARAM_IDS`
6. focused tests in `tests/test_westfold_core.c`

## Common Commands

Use `mise` tasks when available; they wrap the `Makefile`.

```bash
mise run setup   # create .venv and install plotting dependencies
mise run test    # compile and run DSP core smoke tests
mise run render  # render renders/westfold-demo.wav
mise run suite   # render all preset WAVs under renders/westfold-suite/
mise run plot    # render suite and generate waveform/spectrum PNGs
mise run host    # build local host-only shared library
mise run wasm    # build web/wasm/westfold.wasm with Emscripten Docker image
mise run serve   # serve repo at http://localhost:8765/
mise run web     # build WASM then serve the web UI
mise run move    # build aarch64 Move-target module package
mise run check   # run non-device checks: test, suite, plot, host
```

Equivalent `make` targets exist: `make test`, `make render`, `make suite`, `make plot`, `make host`, `make wasm`, `make serve`, `make move`, and `make clean`.

The web UI is served at:

```text
http://localhost:8765/web/
```

## Build And Deploy Flow

Fast local loop:

1. Edit `src/dsp/westfold_core.c`.
2. Run `mise run test`.
3. Run `mise run suite`.
4. Listen to `renders/westfold-demo.wav` and `renders/westfold-suite/*.wav`.
5. Run `mise run wasm` and use the browser UI for interactive checks.

Move package loop:

```bash
mise run move
```

This writes:

```text
dist/westfold/
dist/westfold-module.tar.gz
```

Device install loop:

```bash
./scripts/install-to-move.sh
```

By default this builds first, then copies `dist/westfold/` to:

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

1. Add a single `mise run dev` task that builds WASM, starts the web server, and watches C/JSON files to rebuild `web/wasm/westfold.wasm` when the core changes.
2. Add a `mise run deploy` task that runs `test`, `suite`, `host`, `move`, then `install-to-move.sh`, so the full safe deploy path is one command.
3. Generate `PARAM_IDS` for `web/westfold-worklet.js` from `src/module.json` or a shared parameter manifest to prevent metadata drift.
4. Add a parameter-schema validator that checks `module.json`, `presets.json`, core enum order, WASM IDs, min/max/default bounds, and missing preset values.
5. Add render metrics in CI/local checks: peak, RMS, DC offset, silence detection, clipped-sample count, and per-preset JSON summaries.
6. Add golden render comparison with tolerance, so DSP changes can intentionally update fixtures while accidental regressions are obvious.
7. Add a browser capture/export path that records a short WAV from the current WASM state and stores it beside the offline suite for A/B comparison.
8. Add a Move health-check script that verifies SSH, Schwung module path, free disk space, target architecture, and installed module version before deploy.
9. Add `scripts/tail-move-log.sh` or equivalent if Schwung/Move logs are available over SSH, so deploy failures are visible without manual device digging.
10. Add a module scaffolder that copies the current Westfold pattern into a new module ID, updates metadata, presets, build paths, and web UI labels.
11. Add an FX-module template once the sound-generator flow is stable, with audio-in/audio-out capabilities and a dedicated local render harness for processing fixture WAVs.
12. Add a small preset morph/randomize tool in the web UI to explore parameter spaces quickly, with bounded randomization from `module.json` ranges.
13. Add MIDI learn or configurable CC mapping in the web UI, instead of hard-coding CC 20-27.
14. Add clang-format and a formatting task to keep C changes mechanical and reviewable.
15. Add GitHub Actions or a local pre-push command for `mise run check`, leaving Move deploy as an explicit local-only step.

For the next repo change, the highest-leverage item is probably parameter-manifest generation plus schema validation. The current setup repeats parameter identity across C, JSON, and JS; eliminating that drift will make rapid module iteration less fragile.

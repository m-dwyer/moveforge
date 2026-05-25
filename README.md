# Schwung Module Starter

Starter workspace for developing Ableton Move Schwung sound-generator modules locally before owning the hardware.

The repo currently includes two sound-generator modules:

- `westfold`: compact West Coast style voice with dual oscillator FM, wavefolder, and low-pass gate response
- `dustline`: compact subtractive/noise voice with oscillator blend, resonant filter, and drive

Each module is self-contained under `src/modules/<module-id>/` with its own DSP, Schwung metadata, parameter manifest, presets, and on-device UI.

The default module is `westfold`. Set `MODULE_ID=dustline` on any module-aware command to work on Dustline instead.

Westfold includes:

- dual oscillators with cross-modulated FM
- wavefolder
- low-pass gate style amplitude/filter response
- simple ADSR envelope
- MIDI note handling
- Schwung `move_plugin_init_v2` export
- local WAV renderer for quick listening tests

Schwung is unofficial and not supported by Ableton. Treat device deployment as experimental and keep backups of Move sets/samples.

## Quick Start

Render a local audio demo:

```bash
./scripts/render-demo.sh
```

This writes:

```text
renders/<module-id>-demo.wav
```

Render the comparison suite:

```bash
./scripts/render-demo.sh --suite
```

This writes several labeled clips under:

```text
renders/<module-id>-suite/
```

Build the browser WASM synth:

```bash
./scripts/build-wasm.sh
```

Build Dustline's browser WASM instead:

```bash
MODULE_ID=dustline ./scripts/build-wasm.sh
```

Start the local browser UI:

```bash
pnpm run serve
```

Then open:

```text
http://localhost:8765/
```

The mock shows the Move screen, track and mode buttons, 8 device encoders, wheel controls, transport keys, step buttons, a module selector backed by `src/modules/index.json`, pad layouts, a documented Schwung-style chain (`MIDI FX -> Sound -> Audio FX 1 -> Audio FX 2 -> Settings`), parameter sliders, rendered clip players, and a WASM-backed live synth running in an AudioWorklet. It reads module metadata from `src/modules/<module-id>/module.json` and presets/render clips from `src/modules/<module-id>/presets.json`.

Play the pads or use the computer keyboard row `a w s d r f t g h u j i k o l`; audio starts on the first note. If your browser supports Web MIDI, connected MIDI keyboards are also routed to the synth. MIDI CC 20-27 map to the first eight parameters.

For the fastest browser loop:

```bash
mise run dev
```

This builds browser TypeScript and every module's WASM, serves `http://localhost:8765/`, and rebuilds browser code or WASM when relevant source files change.
The dev server is a small TypeScript/Node static server and watcher; it does not require Python.

Build the module folder and release tarball:

```bash
./scripts/build.sh
```

Outputs:

```text
dist/<module-id>/
dist/<module-id>-module.tar.gz
```

`scripts/build.sh` builds for Move's aarch64 Linux target. It uses Docker automatically when no local cross compiler is present.

For a local-only shared-library compile check:

```bash
./scripts/build-host.sh
```

Do not deploy `dist-host/` to Move; it is for host experiments only.

## Move Target

Schwung modules are drop-in folders under:

```text
/data/UserData/schwung/modules/sound_generators/<module-id>/
```

Once you have a Move with Schwung installed:

```bash
./scripts/install-to-move.sh
```

The script builds first, then copies `dist/<module-id>/` to `ableton@move.local`.

For a checked deploy path:

```bash
mise run deploy
```

This runs DSP tests, renders the preset suite, builds the host library, then builds and installs the Move package. Set `MOVE_HOST=ableton@192.168.1.42` if mDNS is not resolving `move.local`.

## Development Loop

1. Edit DSP in `src/modules/<module-id>/dsp/<module-id>_core.c`.
2. Run `MODULE_ID=<module-id> ./scripts/render-demo.sh --suite`.
3. Listen through `renders/<module-id>-demo.wav` and `renders/<module-id>-suite/*.wav`.
4. Adjust `src/modules/<module-id>/module.json` and `src/modules/<module-id>/params.json` parameter metadata when adding controls.
5. Run `./scripts/build.sh` before packaging or device install.

For AI-assisted iteration, ask for small changes against `src/modules/<module-id>/dsp/<module-id>_core.c` and always render before judging the sound. Audio bugs are much easier to catch from short deterministic WAV fixtures than from code review alone.

The actual synth engine lives in `src/modules/<module-id>/dsp/<module-id>_core.c`; `src/modules/<module-id>/dsp/<module-id>.c` is the Schwung plugin wrapper and `src/modules/<module-id>/dsp/<module-id>_wasm.c` is the browser wrapper. Keep musical DSP changes in the core so Move builds, WAV renders, and browser audio stay aligned.

## Dev Checks

Install local Python plotting dependencies:

```bash
make dev-deps
```

Run the core DSP smoke tests:

```bash
make test
```

Validate that module-scoped parameter metadata matches each module's C core and presets:

```bash
pnpm run validate
```

Render the suite and generate waveform/spectrum PNGs:

```bash
make plot
```

Plots are written to:

```text
renders/plots/<module-id>/
```

Other useful targets:

```bash
make render
make suite
make host
make wasm
make move
make check
make check-all
pnpm run typecheck
pnpm run validate
pnpm run serve
pnpm run emulator-test
```

If you use `mise`, the same entry points are available as tasks:

```bash
mise run setup
mise run test
mise run validate
mise run plot
mise run wasm
mise run web
mise run dev
mise run emulator-test
mise run check
mise run check-all
mise run deploy
```

See `docs/move-emulator-toolchain.md` for the current emulator coverage and remaining gaps against the broader Move/Schwung workflow.

## Useful Upstream References

- Schwung site: https://schwung.dev/
- Schwung repo: https://github.com/charlesvestal/schwung
- Module docs: `upstream/schwung/docs/MODULES.md`
- Plugin ABI: `src/host/plugin_api_v1.h`
- Existing module reference: `upstream/schwung-hush1/`

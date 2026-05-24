# Schwung Module Starter

Starter workspace for developing Ableton Move Schwung sound-generator modules locally before owning the hardware.

The included `westfold` module is a compact West Coast style voice:

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
renders/westfold-demo.wav
```

Render the comparison suite:

```bash
./scripts/render-demo.sh --suite
```

This writes several labeled clips under:

```text
renders/westfold-suite/
```

Build the browser WASM synth:

```bash
./scripts/build-wasm.sh
```

Start the local browser UI:

```bash
./scripts/serve-web.sh
```

Then open:

```text
http://localhost:8765/web/
```

The mock shows the Move screen, track and mode buttons, 8 device encoders, wheel controls, transport keys, step buttons, pad layouts, Schwung-style chain slots, parameter sliders, rendered clip players, and a WASM-backed live synth running in an AudioWorklet. It reads parameter metadata from `src/module.json` and presets/render clips from `src/presets.json`.

Click `Enable WASM Audio`, then play the pads or use the computer keyboard row `a w s d r f t g h u j i k o l`. If your browser supports Web MIDI, connected MIDI keyboards are also routed to the synth. MIDI CC 20-27 map to the first eight parameters.

For the fastest browser loop:

```bash
mise run dev
```

This builds WASM, serves `http://localhost:8765/web/`, and rebuilds the WASM module when DSP or metadata files change.

Build the module folder and release tarball:

```bash
./scripts/build.sh
```

Outputs:

```text
dist/westfold/
dist/westfold-module.tar.gz
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

The script builds first, then copies `dist/westfold/` to `ableton@move.local`.

For a checked deploy path:

```bash
mise run deploy
```

This runs DSP tests, renders the preset suite, builds the host library, then builds and installs the Move package. Set `MOVE_HOST=ableton@192.168.1.42` if mDNS is not resolving `move.local`.

## Development Loop

1. Edit DSP in `src/dsp/westfold.c`.
2. Run `./scripts/render-demo.sh --suite`.
3. Listen through `renders/westfold-demo.wav` and `renders/westfold-suite/*.wav`.
4. Adjust `src/module.json` parameter metadata when adding controls.
5. Run `./scripts/build.sh` before packaging or device install.

For AI-assisted iteration, ask for small changes against `src/dsp/westfold.c` and always render before judging the sound. Audio bugs are much easier to catch from short deterministic WAV fixtures than from code review alone.

The actual synth engine lives in `src/dsp/westfold_core.c`; `src/dsp/westfold.c` is the Schwung plugin wrapper and `src/dsp/westfold_wasm.c` is the browser wrapper. Keep musical DSP changes in the core so Move builds, WAV renders, and browser audio stay aligned.

## Dev Checks

Install local Python plotting dependencies:

```bash
make dev-deps
```

Run the core DSP smoke tests:

```bash
make test
```

Render the suite and generate waveform/spectrum PNGs:

```bash
make plot
```

Plots are written to:

```text
renders/plots/
```

Other useful targets:

```bash
make render
make suite
make host
make wasm
make move
make serve
```

If you use `mise`, the same entry points are available as tasks:

```bash
mise run setup
mise run test
mise run plot
mise run wasm
mise run web
mise run dev
mise run check
mise run deploy
```

See `docs/move-emulator-toolchain.md` for the current emulator coverage and remaining gaps against the broader Move/Schwung workflow.

## Useful Upstream References

- Schwung site: https://schwung.dev/
- Schwung repo: https://github.com/charlesvestal/schwung
- Module docs: `upstream/schwung/docs/MODULES.md`
- Plugin ABI: `src/host/plugin_api_v1.h`
- Existing module reference: `upstream/schwung-hush1/`

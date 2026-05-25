# Move And Schwung Emulator Toolchain

This branch turns the browser mock into a broader Move/Schwung iteration harness. It is still not a complete stock Move clone, but it now models the interaction surfaces that matter most when developing custom Schwung modules locally.

## What The Emulator Now Covers

- Move-style hardware shell: track buttons, mode buttons, 8 device encoders, wheel controls, transport keys, 16 step buttons, and 32 pads.
- Schwung chain view: documented slot chain shape, `MIDI FX -> Sound Generator -> Audio FX 1 -> Audio FX 2 -> Settings`, with selected-slot and bypass state.
- Functional local MIDI FX: `Scale Gate` can transpose, scale-lock, probability-gate, and velocity-scale notes before they reach the synth.
- Functional local Audio FX: `Drive Tone` and `Air Tone` apply post-synth drive, tone smoothing, and wet/dry mix in the AudioWorklet.
- Master FX view: Note/Session toggles a four-slot master effects chain.
- Slot settings: knob/routing/LFO settings are represented locally, including Receive Ch, Forward Ch, MIDI FX output mode, and two LFO indicators.
- Device view: 8 parameters per page, encoder touch/highlight behavior, page navigation, and parameter value feedback on the OLED canvas.
- Preset browser view: wheel-driven preset selection and loading.
- Step harness: 16-step local sequencer, selected step state, play/stop, step clearing, and basic parameter locks while recording in step mode.
- Pad layout engine: chromatic, in-key octaves, and in-key fourths with root, scale, and octave controls.
- WASM audio path: pad, keyboard, Web MIDI, step playback, preset, and parameter events all route into the same AudioWorklet synth.

## Fast Local Loop

```bash
mise run dev
```

This builds `web/wasm/<module-id>.wasm`, serves the repo, and watches `src/modules/<module-id>/` plus the browser worklet files that affect the web synth. Open:

```text
http://localhost:8765/web/
```

For the second included synth, use the Module selector in the web UI.

```bash
mise run dev
```

Then open:

```text
http://localhost:8765/web/
```

Use this loop for quick sound-design changes before building a Move package.

## Checked Device Loop

```bash
mise run deploy
```

This runs the core DSP tests, renders the preset suite, builds the host library, then builds and installs the Move package via `scripts/install-to-move.sh`.

Set the target with:

```bash
MOVE_HOST=ableton@move.local mise run deploy
```

or:

```bash
MOVE_HOST=ableton@192.168.1.42 mise run deploy
```

## Remaining Gaps

The toolchain is now credible for deciding whether Schwung can support fast local synth iteration, but several pieces are still worth building before heavy module work:

1. Generate parameter IDs for C/WASM/JS from one manifest.
2. Extend validation to step/render fixtures in addition to each module directory's `module.json`, `params.json`, and `presets.json`.
3. Add golden render metrics: peak, RMS, DC offset, silence, clipping, and tolerance comparison.
4. Add full FX-module mode with fixture WAV input, WASM processing, and output comparison.
5. Add a module scaffolder for new synths, MIDI FX, and audio FX.
6. Add real Move log tailing and install health checks once hardware is available.
7. Add browser recording/export so current WASM sessions can be captured as WAV fixtures.
8. Add browser-side preset save/export back to JSON.
9. Calibrate exact display, LED, and gesture timing with real hardware via Schwung screen mirroring.

## Practical Confidence Check

Before buying the Move, this repo can already prove the most important part: one shared DSP core can be exercised through offline renders, browser WASM auditioning, and Move-target builds. The remaining unknowns are mostly device integration details: Schwung install state, exact log paths, SSH reliability, on-device CPU headroom, and how closely the real Shadow UI behavior matches the simplified chain model here.

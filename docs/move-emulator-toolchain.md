# Move And Schwung Emulator Toolchain

This branch turns the browser mock into a broader Move/Schwung iteration harness. It is still not a complete stock Move clone, but it now models the interaction surfaces that matter most when developing custom Schwung modules locally.

## What The Emulator Now Covers

- Move-style hardware shell: track buttons, mode buttons, 8 device encoders, wheel controls, transport keys, 16 step buttons, and 32 pads.
- Schwung chain view: documented slot chain shape, `MIDI FX -> Sound Generator -> Audio FX 1 -> Audio FX 2 -> Settings`, with selected-slot and bypass state.
- Functional local MIDI FX: `Scale Gate` can transpose, scale-lock, probability-gate, and velocity-scale notes before they reach the synth.
- Functional local Audio FX: `Drive Tone` and `Air Tone` apply post-synth drive, tone smoothing, and wet/dry mix in the AudioWorklet.
- Slot settings: Schwung-aligned setting keys are represented locally, including `slot:receive_channel`, `slot:forward_channel`, `midi_fx_pre_mode`, and minimal `lfo1:*` / `lfo2:*` state. Browser audition does not yet apply these host-level settings.
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
http://localhost:8765/
```

For the second included synth, use the Module selector in the web UI.

```bash
mise run dev
```

Then open:

```text
http://localhost:8765/
```

Use this loop for quick sound-design changes before building a Move package.

## Checked Device Loop

```bash
mise run move-deploy
```

This runs the full `check` gate — typecheck, param/codegen validation, chain-UI tests, the core DSP tests with and without sanitizers, the preset suite compared against goldens, the stress safety checks, plots and the host build — then builds and installs the Move package.

While iterating on hardware, `mise run move-install` does the same build and copy without the gate.

Set the target with:

```bash
MOVE_HOST=ableton@move.local mise run move-deploy
```

or:

```bash
MOVE_HOST=ableton@192.168.1.42 mise run move-deploy
```

For device-side debugging after deploy:

```bash
mise run move-health
./scripts/tail-move-log.sh --enable --clear --yes
./scripts/clear-move-cache.sh --apply
mise run move-restart
mise run move-screen
```

See `docs/schwung-device-workflow.md` for the checked hardware loop.

## Remaining Gaps

The toolchain is now credible for deciding whether Schwung can support fast local synth iteration, but several pieces are still worth building before heavy module work:

1. Implement the host-level behavior tracked in `docs/schwung-host-feature-gaps.md`: slot settings, MIDI FX pre mode, LFO modulation, and Master FX.
2. Add browser recording/export so current WASM sessions can be captured as WAV fixtures.
3. Add browser-side preset save/export back to JSON.
4. Calibrate exact display, LED, and gesture timing with real hardware via Schwung screen mirroring.

## Practical Confidence Check

Before buying the Move, this repo can already prove the most important part: one shared DSP core can be exercised through offline renders, browser WASM auditioning, and Move-target builds. The remaining unknowns are mostly device integration details: Schwung install state, exact log paths, SSH reliability, on-device CPU headroom, and how closely the real Shadow UI behavior matches the simplified chain model here.

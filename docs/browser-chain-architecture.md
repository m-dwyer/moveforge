# Browser Signal Chain — next-phase plan

## Goal

Replicate Schwung's on-device signal chain in the browser so a developer can
audition real chains end-to-end without flashing the Move:

```
[MIDI FX] -> [Sound Generator] -> [Audio FX 1] -> [Audio FX 2] -> output
```

Each slot is a real moveforge module (one of the three template kinds),
running its actual C DSP via WASM. Today the browser is single-module
only; this turns it into a true chain host.

## Why this matters

- Today's browser path audits one DSP at a time. The thing you actually
  deploy is a *chain*. A drive sound through a reverb sounds different
  than the raw drive — you can't iterate on either properly in isolation.
- The audio FX path we just built (`tools/render_fx.c` + browser WASM with
  input pointers) is the prerequisite. The infrastructure exists, just
  not the orchestration to feed one node's output into the next.
- midi_fx is currently untestable in the browser at all — it has no
  audio output of its own. A chain unlocks live midi_fx audition (play a
  pad → see the arpeggiator emit notes → hear them through the sound gen).

## What exists today

- `web/src/audio-engine.ts` — manages a single `AudioWorkletNode` loaded
  with one module's WASM. Connects directly to `audio.destination`.
- `web/module-worklet.js` — generic processor; handles `mf_*` (sound_gen or
  audio_fx) and `sch_*` (Schwung wrapper) ABIs. Feeds `inputs[0]` into the
  WASM input buffers if the module exports `mf_in_left_ptr`.
- `web/src/app.ts` — chain UI exists visually (the "MIDI FX / Sound /
  Audio FX 1 / Audio FX 2 / Settings" panel) but the FX slots are mock:
  they show preset names like "Drive Tone" that don't correspond to real
  modules. `audioFxPayload`/`audioFxSlots` were removed when we deleted
  the JS fake FX, so the slot state is currently inert for audio routing.
- `web/src/chain-state.ts` — already models a chain. Worth reading first
  before re-designing state.
- Per-module WASM builds: working for sound_generator (`<id>.wasm` +
  `<id>-schwung.wasm`) and audio_fx (`<id>.wasm` only — no Schwung-wrapped
  build per the parked decision in `docs/browser-wrapper-modes.md`).
  midi_fx has no WASM build yet.

## What's missing

1. **Per-slot worklet instances.** AudioEngine manages a single node;
   needs to manage N nodes connected in series.
2. **Module picker per slot.** UI needs a dropdown per chain slot that
   lists modules of the appropriate `component_type` (midi_fx for the
   MIDI slot, sound_generator for the sound slot, audio_fx for the FX
   slots).
3. **MIDI FX wiring.** midi_fx modules emit MIDI events; those need to
   reach the sound_generator. midi_fx has no WASM today — needs a wasm
   wrapper file added to `_template_midi_fx/` and `build-wasm.sh`
   extended.
4. **AudioContext lifecycle for chain rebuilds.** When the user changes
   which module fills a slot, the worklet for that slot needs to be torn
   down + replaced without dropping the rest of the chain.
5. **Hot-reload of one slot in a chain.** dev-reload already works for
   single-module; needs to reload only the affected node.

## Design decisions to make

### MIDI FX → Sound Generator routing

Three options:
- **Main thread relay (recommended).** midi_fx worklet emits MIDI via
  `port.postMessage`, app.ts receives, forwards to sound_gen worklet via
  its `port.postMessage`. ~1ms extra latency. Simple, fine for dev.
- **Direct worklet→worklet via SharedArrayBuffer.** Faster, but requires
  COOP/COEP HTTP headers on the dev server and a ring buffer design.
  Overkill for a dev harness.
- **AudioWorklet MessagePort direct connection.** Possible in principle
  but not well-trodden territory.

Go with main thread relay.

### midi_fx WASM ABI

midi_fx has no audio I/O — it doesn't fit the `mf_render(frames)` shape.
Needs its own minimal ABI:

```
mf_init() / mf_set_param(id, value) / mf_get_param(...)
mf_process_midi_byte(status, d1, d2) -> emits to mf_out_buf,
                                        returns count of emitted messages
mf_tick(frames) -> may emit time-based MIDI (arpeggiator, clock)
mf_out_buf_ptr() / mf_out_count_ptr()
```

The worklet copies emitted messages out and posts them to the main thread
on each MIDI input event + each `process()` call (for tick output).

### audio_fx Schwung-wrapped build

Decision deferred. The parked task #21 (drop WASM mode entirely) might
make this moot. For now, audio_fx uses `mf_*` ABI directly via its WASM
wrapper.

## Task breakdown

Rough order; each is a focused commit.

1. **midi_fx WASM build + wrapper** (~2h)
   - Add `_template_midi_fx/dsp/MODULE_ID_wasm.c` exposing the new ABI
   - Extend `scripts/build-wasm.sh` to build midi_fx WASM with appropriate
     exports (no `_mf_in_*` / `_mf_render`, has `_mf_process_midi_byte`,
     `_mf_tick`, `_mf_out_buf_ptr`, `_mf_out_count_ptr`)
   - Update `web/module-worklet.js` to recognize midi_fx mode (look for
     `mf_process_midi_byte` export, dispatch differently)

2. **AudioEngine chain refactor** (~3-5h)
   - Replace single-node model with `Map<slotId, AudioWorkletNode>`
   - `enableChain(slots)`: instantiate worklets, connect in series, load WASM
   - `replaceSlot(slotId, moduleId)`: tear down old, instantiate new, re-wire
   - `removeSlot(slotId)`: disconnect + dispose
   - Preserve hot-reload: events route to specific slot's worklet

3. **Per-slot module picker UI** (~2-3h)
   - Each chain slot becomes a dropdown of compatible modules (from
     `src/modules/index.json` filtered by `kind`)
   - State (chain-state.ts) gains per-slot moduleId
   - Changes trigger `audioEngine.replaceSlot(...)`

4. **MIDI FX wiring** (~2-3h)
   - app.ts intercepts noteOn/noteOff before sending to sound gen
   - If MIDI FX slot is active, send to midi_fx worklet first
   - midi_fx worklet posts emitted MIDI back via port
   - app forwards each emitted MIDI message to sound gen worklet

5. **Edge cases + polish** (~2-4h)
   - Slot reorder (audio_fx slots specifically)
   - Bypass per slot (re-wire connections to skip a slot)
   - Hot-reload of a single slot during dev (currently dev-reload triggers
     `audioEngine.reload()` which assumes single module)
   - AudioContext suspend/resume across chain changes

**Total: 1-2 focused days.** Hardest piece is probably #2 (the chain
refactor) since it touches the audio graph lifecycle.

## How to pick this up in a fresh session

When you start a new session for this work, tell the agent:

1. Read `CLAUDE.md` (project conventions + the codegen + ui_chain.js notes)
2. Read `docs/browser-chain-architecture.md` (this file)
3. Read `docs/browser-wrapper-modes.md` (the parked WASM-mode decision —
   relevant because if we end up dropping WASM mode first, the chain
   refactor changes shape)
4. Look at recent commits since `6ab1717` (codegen baseline)
5. Look at `web/src/chain-state.ts` and the chain section of `web/src/app.ts`
   to understand current state shape

Then start with task 1 (midi_fx WASM) — it's the smallest piece and proves
the new ABI shape works before committing to the chain refactor.

## Pre-flight: revisit parked decisions first?

The parked WASM-mode-drop (`docs/browser-wrapper-modes.md`, task #21) is
worth resolving before this chain work, because:
- If WASM mode goes away, the chain only deals with the Schwung-wrapped
  WASM ABI for sound_gen and audio_fx, which means the int16 conversion
  happens at every chain stage — matches device truth
- If WASM mode stays, the chain has to pick which ABI per slot

Recommended order: (a) drop WASM mode, (b) chain refactor. That way the
chain code only deals with one ABI per module kind.

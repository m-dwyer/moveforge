# Faust-First Schwung DSP Workflow Plan

## Goal

Make Moveforge faster and safer for developing Schwung synths, sound engines,
and FX modules for Ableton Move.

Use Faust as the preferred high-level DSP authoring path where it helps, while
keeping C/C++ as the canonical Schwung/device integration path and fallback.

## Core Direction

- Keep the existing Moveforge C core interface as the device-facing contract.
- Add Faust as an optional source format for audio DSP.
- Browser testing, offline rendering, and Move deployment should still run
  through the Schwung wrapper path.
- Do not rely on Faust's standalone browser/WebAudio path for final validation.
- Allow fallback to hand-written C/C++ whenever Faust becomes awkward, too
  opaque, or too slow.

## Why Faust

Faust may reduce:

- repeated hand-written oscillator/filter/envelope/delay code
- memory-risky raw C
- crashes from manual state handling
- friction for LLM-assisted DSP iteration
- time from sound idea to audible prototype

Faust is especially promising for:

- audio FX
- filters
- delays
- waveshapers
- compact sound engines
- simple synth voices

C/C++ remains better for:

- Schwung ABI wrappers
- Move packaging
- MIDI FX
- complex event/state machines
- performance-critical hand tuning
- unusual host interactions
- debugging generated-code edge cases

## Proposed Module Model

For Faust-backed modules:

```text
src/modules/<id>/
  module.json
  presets.json
  ui.js
  ui_chain.js
  dsp/
    <id>.dsp          # Faust DSP source
    <id>_core.h       # Moveforge core interface
    <id>_core.c       # adapter/generated wrapper around Faust DSP
    <id>.c            # Schwung wrapper
```

The Faust source should not replace the Schwung wrapper. It should feed the
same wrapper pipeline already used by C modules.

## Required Build Flow

A Faust-backed module must support:

```bash
pnpm run validate
./scripts/test.sh
MODULE_ID=<id> ./scripts/render-demo.sh --suite
MODULE_ID=<id> ./scripts/build-wasm.sh
MODULE_ID=<id> ./scripts/build.sh
```

And eventually:

```bash
MODULE_ID=<id> ./scripts/install-to-move.sh
```

## Scaffolding

Module creation supports a DSP source option:

```bash
pnpm run new-module -- --id shimmer_drive --kind audio_fx --dsp faust
pnpm run new-module -- --id tiny_voice --kind sound_generator --dsp faust
pnpm run new-module -- --id arper --kind midi_fx --dsp c
```

Defaults:

- `sound_generator`: defaults to `faust`, allows `c` fallback
- `audio_fx`: defaults to `faust`, allows `c` fallback
- `midi_fx`: defaults to `c`; Faust is rejected

## C/C++ Fallback Rules

Fallback to C/C++ when:

- MIDI/event behavior dominates the module
- Faust parameter/event modeling becomes contorted
- generated code is hard to debug
- performance or memory layout needs manual control
- integration requires Schwung host-specific behavior
- a bug cannot be localized quickly in Faust-generated output

Mixed modules should be allowed:

- Faust for sample-by-sample audio DSP
- C for MIDI, note state, wrapper logic, allocation, or special processing

## Important Harness Improvements

Before or alongside Faust support:

1. Infer Move install path from `module.json`.
   - Avoid manually passing `COMPONENT_TYPE`.
   - Map:
     - `sound_generator -> sound_generators`
     - `audio_fx -> audio_fx`
     - `midi_fx -> midi_fx`

2. Fix package completeness.
   - `scripts/build.sh` should include:
     - `module.json`
     - `ui.js`
     - `ui_chain.js`
     - `presets.json`
     - `dsp.so`

3. Update stale scaffold messages.
   - Current code suggests audio FX and MIDI FX lack browser/offline paths.
   - The repo now has render/WASM support for these paths.

4. Add a fast iteration command.

```bash
mise run iterate
```

Suggested behavior:

- validate params
- run selected module core test
- render suite
- check render metrics
- build WASM

5. Keep Move deploy explicit.

```bash
mise run deploy
```

## Bake-Off

Run a small Faust-vs-C experiment before committing too deeply.

### Test 1: Audio FX

Drive/tone/mix module.

Evaluate:

- edit speed
- parameter mapping
- offline render
- WASM build
- Move package
- generated code size
- debugging experience

### Test 2: Sound Generator

Simple oscillator, envelope, filter, MIDI note input.

Evaluate:

- MIDI handling friction
- Faust/C split
- render determinism
- browser audition fidelity
- Move build viability

## Acceptance Criteria

Faust is worth first-class support if:

- Faust source can compile into the existing Moveforge core/wrapper shape.
- Offline render uses the Schwung wrapper.
- Browser WASM uses the Schwung wrapper.
- Move package remains normal.
- Params stay synced with `module.json`.
- Debugging is acceptable.
- Iteration feels materially easier than hand-written C.

If Faust only wins for audio FX, support Faust for FX first.

If Faust adds too much glue or bypasses Schwung fidelity, keep it as a
scratchpad only and improve the C workflow instead.

## Future Codex/Claude Skill

Later, create a reusable workflow skill or agent guide.

Name idea:

```text
schwung-dsp-development
```

Purpose:

- create Schwung modules
- prefer Faust for audio DSP when appropriate
- use C/C++ fallback when needed
- keep Moveforge wrapper/render/WASM/deploy flows consistent
- guide LLMs toward simple, debuggable DSP changes

Portable structure:

```text
docs/schwung-dsp-development.md
~/.codex/skills/schwung-dsp-development/SKILL.md
```

Claude can reference the repo doc through `CLAUDE.md`; Codex can use the
personal skill.

## Recommended Next Step

Start with the Faust-backed audio FX spike.

Target module:

```text
faust_drive
```

Minimal params:

- `drive`
- `tone`
- `mix`
- `level`

It should:

- render sweep/impulse/noise fixtures
- build browser WASM through Schwung glue
- build a Move package
- prove whether Faust can live cleanly inside Moveforge

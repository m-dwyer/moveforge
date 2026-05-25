# Browser wrapper modes — parked discussion

This note captures an unresolved design question from 2026-05-26: should the
browser auditioning path support both "WASM" (float-only) and "Schwung"
(int16, device-faithful) wrappers, or just one?

## Background

Each module currently builds two `.wasm` artifacts:

- `web/wasm/<id>.wasm` — built from `<id>_wasm.c` + `<id>_core.c`. Exports the
  `mf_*` ABI. Audio stays in float end-to-end.
- `web/wasm/<id>-schwung.wasm` — built from `<id>.c` (the Schwung wrapper) +
  `<id>_core.c` + `src/host/schwung_wasm_glue.c`. Exports the `sch_*` ABI.
  Audio goes through `render_block` which produces int16, then the glue
  converts back to float for the AudioWorkletNode.

The browser UI has a "Wrapper" dropdown that swaps between them.

## The audible difference

The same pad sounds slightly different in the two modes. Two real causes:

1. **int16 quantization** in Schwung mode. Noise floor at ~−96 dBFS. Below
   the threshold of audibility on most setups, but technically present.
2. **Hard clipping** at the int16 boundary in Schwung mode. If `process_float`
   produces samples outside `[-1, 1]` (possible with FM, fold, drive, etc.),
   the wrapper hard-clips them; WASM mode passes them through as floats and
   relies on the OS audio stack to clip later. This creates audibly different
   harmonic content. **Schwung mode is the truth-telling path here** — it
   shows what device output will sound like; WASM mode hides overshoot.

## Why Schwung uses int16

Hardware constraint. The Move SPI audio mailbox is fixed int16:

> Audio OUT: 128 stereo int16 (per `upstream/schwung/CLAUDE.md` SPI protocol section)

So the boundary at the SPI transfer is non-negotiable. Whether Schwung's
*internal* signal chain between audio_fx modules could stay in float is a
separate question — `audio_fx_api_v2_t` currently passes int16 in-place
buffers (`void (*process_block)(void *instance, int16_t *audio_inout, int frames)`),
so chain stages each round-trip through int16. This is an upstream API
choice we can't change unilaterally.

## What does float "sound better" mean?

For a single module played at normal levels: not in any meaningful way.

- 16-bit int = ~96 dB dynamic range, sub-audible noise floor for typical
  synth content
- Float matters for *cumulative* processing (long FX chains, mixing many
  sources). Doesn't apply here — one module, one int16 truncation.

So WASM mode doesn't sound "better" — it sounds *different in a way that
can't exist on device*. The Schwung mode's int16-quantized output is what
plays on Move.

## The dilemma

- **Argument for keeping WASM mode:** faster iteration on small DSP tweaks,
  cleaner reference for "what does the pure DSP sound like."
- **Argument for dropping WASM mode:** it's the outlier — everything else
  (offline renders, Schwung browser mode, device) is int16. Iterating against
  WASM mode means your DSP sounds *cleaner than truth*, leading to surprises
  on deploy. The "pure DSP reference" is also already provided by
  `tools/render_wav.c` (which writes 16-bit WAVs too — so even the offline
  reference is int16).

The honest conclusion was: **drop WASM mode, keep Schwung mode as the only
browser path.** But this was parked to avoid scope-creep in the FX path PR.

## What needs to happen if we drop WASM mode

- Delete `<id>_wasm.c` from every module + template
- Delete `src/host/schwung_wasm_glue.c`'s `_wasm.c` counterparts
- Update `schwung_wasm_glue.c` to handle both `move_plugin_init_v2` (sound
  generator) and `move_audio_fx_init_v2` (audio FX). The glue dispatches to
  the right entry symbol at link time and exposes appropriate input/output
  pointers (audio_fx adds `sch_in_left_ptr` / `sch_in_right_ptr`).
- Update `scripts/build-wasm.sh` to build only one artifact per module.
- Remove the wrapper dropdown from the browser UI.
- Update `web/module-worklet.js` to drop the "wasm" branch.
- Rework the audio_fx FX path (currently routes through `mf_*` exports) to
  use the unified Schwung-wrapped glue instead.

## Status

**Parked.** Revisit after FX path, midi_fx trace harness, WASM hot-reload,
and render-diff are done. At that point we can do the cleanup as a focused
PR.

If you reopen this: the easiest test for "should I drop WASM mode?" is to
see whether anyone has actually relied on float-only output for anything.
If not, the simplification is free.

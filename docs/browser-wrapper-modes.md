# Browser wrapper modes — resolved

**Status: shipped on the `drop-wasm-mode` branch.**

Historical context: the repo used to build two WASM artifacts per module —
a moveforge-invented `mf_*` ABI (`<id>.wasm`, float audio end-to-end) and
the actual Schwung wrapper compiled to WASM via `schwung_wasm_glue.c`
(`<id>-schwung.wasm`, int16 round-trip mirroring device behavior). The
browser had a dropdown to switch between them.

This was wrong:

- The "mf" mode showed audio that won't exist on Move (no int16 truncation,
  no overshoot clipping). Iterating against it hid problems that would
  appear on deploy.
- The "they sound different" symptom that motivated the investigation was
  actually a latent bug: `AudioWorkletGlobalScope` doesn't expose
  `TextEncoder` in Chrome, so the Schwung-mode `writeCString` was throwing
  silently, so Schwung-mode `sch_set_param` never reached the C core, so
  modules ran at default params in Schwung mode while mf mode applied
  them correctly. After that fix landed (commit `4f3fba1`), the two
  wrappers sounded effectively identical.
- The mf mode was the only path keeping audio in float; everything else
  (offline render WAVs are 16-bit, device output is 16-bit) was already
  int16. mf was the outlier, not the canonical.

The cleanup:

- Deleted `<id>_wasm.c` from every module + template
- Renamed `schwung_wasm_glue.c` → `schwung_wasm_glue_sg.c`, added
  `schwung_wasm_glue_fx.c` for the audio_fx in-place int16 path
- Build script picks the right glue per `component_type`, produces one
  `web/wasm/<id>.wasm`
- Worklet collapsed to one ABI (`sch_*`); the wrapper dropdown removed
- Per-module surface area dropped by one file (the `_wasm.c`)

What's left:

- midi_fx still has no browser path (no audio I/O — needs a different
  approach when chain-worklets land; see `docs/browser-chain-architecture.md`)
- Browser auditioning still routes a single module direct to output; chain
  audition is the next phase

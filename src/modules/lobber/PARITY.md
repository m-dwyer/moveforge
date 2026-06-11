# Lobber — parity checklist vs. the Timetosser (model OT15) manual

Lobber is an original Schwung `audio_fx` module **inspired by** the alter.audio
Timetosser (firmware 1.1.1). It is not affiliated with or endorsed by alter.audio; the
DSP is written from scratch against the published behavior. The vendor manual is kept
**outside** this repo (reference only) — do not commit it.

This is a living checklist. Tick items as they land. Phase 1 (Live Input Mode) is
committed; phase 2 adds the corrected slice grid + Loop/Slice modes.

## Hard constraints
- **Web-UI reachable.** Every feature must be drivable from `module.json` params (knobs
  in the browser), not solo-mode pads only. Pads are an on-device convenience layer.
- **Keep DSP in the shared core.** Wrappers/UI/tests call the public API; no DSP logic
  in wrappers or web code.

## Deferred (explicitly out of scope)
- Sequences (Section 3 "Sequence Select" — 8 programmed patterns per step length).
  `ratchet` stays as the crude stutter-subdivision stand-in.
- Full MIDI-note-map alignment to Section 6 (notes 60–75). Port-local pad map instead.
- Hardware/firmware-only surfaces the Move host owns: tap-tempo/beat-finder/MIDI-sync/
  gate-sync, LED-color fidelity, input-level meter, plugin-instance selection, VST.

---

## Phase 1 — Live Input Mode ✅ (committed)
- [x] Tempo-quantized delay: delay time = step length × step number.
- [x] Stutter (loop) / delay-throw, reverse, freeze (= device "record-stop").
- [x] Declick crossfades on jump + loop seam; wet/dry slew.
- [x] 16-pad toss grid; host-tempo sync with bpm fallback.

## Phase 2 — Gap 1: step-length ("Slice") grid  *(correctness)*
- [x] `LOBBER_DIV_BEATS[6] = { 1, 1/2, 1/4, 2/3, 1/3, 1/6 }` → 1/4,1/8,1/16,1/4T,1/8T,1/16T (drop 1/32).
- [x] `lobber_core.c`: table + `di` clamp (`>5`) + `lb_slice_len`.
- [x] `module.json`: `division.max` 4→5; refresh name/comment.
- [x] `lobber_core.h`: division comment.
- [x] `metadata.json`: division description.

## Phase 2 — Gap 2: Loop Mode + Slice Mode  *(Section 4)*
New params (then `gen-params`):
- [x] `mode` 0..2 (0=Live,1=Loop,2=Slice), `loop_beats` 1..16, `capture` 0/1, `mute` 0/1.
- [x] `root.knobs` reordered into 2 banks of 8.
Core:
- [x] Loop buffer `loop_l/loop_r[LOBBER_LOOP_LEN=1<<19]` + `loop_filled/loop_len_samples/loop_beats_captured`.
- [x] Capture: rising edge on `capture` snapshots last `loop_beats` beats from the ring (clamp > ring); auto-capture on first Loop/Slice entry.
- [x] Source abstraction (ring vs loop) reused by the existing toss/window/reverse/declick path.
- [x] Loop Mode: continuous loop, rudimentary varispeed time-stretch to current tempo; toss offset jumps within loop; live not mixed; transport-stop mutes.
- [x] Slice Mode: dry passthrough (unless mute); one-shot slice voice from `active` rising edge / pad; reverse applies.
- [x] Mute zeros dry; effective reverse/freeze = param OR `midi_*_held`.
Wrapper:
- [x] `lobber_set_transport(core, running)` from `get_clock_status()==RUNNING`; no clock ⇒ running.

## Phase 2 — Gap 3: solo control surface
- [x] `ui.js` function row (pads 16–21): mode-cycle, reverse(momentary), freeze(momentary), mute(toggle), capture.
- [x] `lobber_handle_midi`: function notes set `midi_*_held`/toggle mute/set mode/pulse capture; steps keep `note % 16`.
- [x] `gen-ui-chain` regenerated.

## Phase 2 — presets, tests, goldens
- [x] Rewrite `presets.json` for the new grid + Loop/Slice demos.
- [x] `test_lobber_core.c`: six slice lengths; Live regression; Loop (loops, transport-stop silence); Slice (one-shot, mute); time-stretch finite/normalized.
- [x] `lobber-ui.test.ts`: step pads + function row.
- [x] `suite`/`plot`; `bless-renders`; refresh `goldens/lobber/metrics.json` + `MODULES.md`.

## Verification gates
- [x] `gen-params`/`gen-presets`/`gen-ui-chain` no drift; `mise run validate`.
- [x] `MODULE_ID=lobber mise run test`.
- [x] `MODULE_ID=lobber mise run suite && … plot`.
- [ ] Browser: `wasm` + `serve`, drive Live/Loop/Slice from knobs.
- [x] `mise run web-test`; `mise run check`.

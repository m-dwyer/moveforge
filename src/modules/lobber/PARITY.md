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

---

## Cold-start orientation (read this first if picking up the deferred work)

**The spec is the Timetosser OT15 manual** (firmware 1.1.1), kept at `~/src/time_tosser.pdf`
(outside the repo — copyright). Relevant sections: **2–3** playing/keys, **4** play modes,
**6** MIDI map. Read the section named under each deferred item below.

**Where the code lives** (plain-C `audio_fx`, API v2):
- `dsp/lobber_core.{c,h}` — all DSP + state. `dsp/lobber.c` — Schwung wrapper (tempo +
  transport from the host clock). `ui.js` — solo pad UI. `ui_chain.js` — generated.
- `module.json` — param schema + `knobs` (single source of truth). `metadata.json` —
  param descriptions + randomize hints. `presets.json` — presets + render clips.
- Generated, **never hand-edit**: `dsp/*_params.gen.inc`, `dsp/*_presets.gen.inc`,
  `dsp/*_scope.gen.inc`, `ui_chain.js`. Re-run `gen-params`/`gen-presets`/`gen-ui-chain`.

**Key implementation facts a fresh agent will otherwise re-derive:**
- Params (keys): `active`(label "Lob"), `offset`, `division`, `mode`, `loop`, `ratchet`,
  `reverse`, `freeze`, `mute`, `capture`, `loop_beats`, `mix`, `bpm`, `xfade`.
- `division` grid: `LOBBER_DIV_BEATS[6] = {1, 1/2, 1/4, 2/3, 1/3, 1/6}` →
  1/4,1/8,1/16,1/4T,1/8T,1/16T. Slice length via `lb_slice_len`; public accessor
  `lobber_slice_samples()`.
- Two buffers, both `1<<19`: ring (`buf_l/buf_r`, always recording unless `freeze`) and
  captured loop (`loop_l/loop_r`). `lb_idx` masks the ring; `lb_loop_wrap` mods the loop.
- **MIDI convention** (`lobber_handle_midi`): **channel 0** = toss grid (`note % 16` →
  offset). **channel 1** = function keys, `LOBBER_FN_*` enum `{0 MODE,1 REVERSE,2 FREEZE,
  3 MUTE,4 CAPTURE}`. `ui.js` injects ch0 for the 16 pads, ch1 for the function row.
- `mode`: 0 Live (ring toss), 1 Loop (varispeed loop, `loop_rate = loop_len/target_len`),
  2 Slice (one-shot voice + auto-advancing "default sequence" while held).
- Capture: explicit rising edge on `capture` snapshots immediately; Loop/Slice auto-capture
  once `write_pos >= loop_beats * beat_samples`. Transport-stop mutes Loop
  (`lobber_set_transport`; no host clock ⇒ treated as running).
- Effective `reverse`/`freeze` = param OR the momentary `midi_*_held` flag.

**Dev loop** (`pnpm` is only on PATH inside mise → use `mise exec -- pnpm …`):
```
MODULE_ID=lobber mise run test          # C core tests (tests/test_lobber_core.c)
mise exec -- pnpm run test:ui-chain     # node tests incl. tests/lobber-ui.test.ts
MODULE_ID=lobber mise run suite && MODULE_ID=lobber mise run plot   # renders + PNGs
MODULE_ID=lobber mise exec -- pnpm run bless-renders                # re-bless goldens
mise run validate                       # codegen drift + schema
MODULE_ID=lobber mise run wasm          # browser build
```
Goldens: `goldens/lobber/metrics.json`; plots: `renders/plots/lobber/`.

## Deferred work — actionable specs

Ordered roughly by value. Each is currently **not** implemented.

1. **Sequences** (manual §3 "Sequence Select", §4 Slice "default sequence"). Each step
   length has 8 pre-programmed rhythmic patterns; holding a step key plays one; the default
   (the "0" sequence) just repeats the current step. *Approach:* add a `sequence` param
   (0..7) + a pattern table (arrays of {offset/step, gate} per pattern); in Live/Slice,
   while `want_toss` is held, step through the pattern on slice boundaries instead of the
   current static repeat / `ratchet` subdivision. *Files:* `lobber_core.c` (pattern engine
   + per-step advance), `module.json`/`metadata.json`/`presets.json`, tests. *Gotcha:* the
   manual doesn't publish the 8 patterns — design plausible ones (or transcribe from the
   vendor's demo videos) and document the choice. `ratchet` can stay or fold into this.

2. **Device MIDI note map** (manual §6, notes 60–75). Steps 0–7 = 60–67, shift (75) → 8–15;
   68 Mode, 69 Tap, 70/71/72 note keys, 73 Reverse, 74 Mute. *Approach:* add a device-faithful
   mapping path in `lobber_handle_midi` for **external** MIDI, while keeping the current
   port-local ch0/ch1 convention that `ui.js` uses for Move pads (or migrate both). *Gotcha:*
   the present "any ch0 note → `note % 16`" contract and its tests assume the port-local map —
   reconcile before changing, and update `tests/test_lobber_core.c`.

3. **Momentary mute/unmute combos** (manual §3 Mute key). Hold a step + Mute = momentary
   mute (un-mutes on Mute release); hold Mute + step = momentary un-mute. *Approach:* track
   mute-held vs step-held interaction in `lobber_handle_midi`/process; today `mute` is a plain
   toggle. *Files:* `lobber_core.c`, `ui.js`.

4. **Erase Loop** (manual §4). Holding the Live-mode key >0.5 s clears the recorded loop and
   returns to Live. *Approach:* a `clear`/long-press control that sets `loop_filled = 0`.
   *Files:* a control in `module.json` or a ui.js gesture + a core reset.

5. **Sync sources** (manual §3 tap-tempo / beat-finder / MIDI-sync / gate). N-A on Move (the
   host clock drives tempo). Only worth it for a standalone/browser tap-tempo. Leave deferred
   unless targeting standalone.

6. **Slice additive headroom** (not a manual feature — a quality nit). Slice mode layers slices
   over the dry input additively, so a hot source clips (the manual itself warns about hot
   signals). Optional: duck the dry while a slice is active, or scale, instead of pure add.
   *File:* the Slice branch in `lobber_process_float`.

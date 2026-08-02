# Adaptive scope rendering — future plan

Status: **proposed / not implemented.** Captures the design for an auto-adaptive
default scope style, so the decision and rationale aren't lost.

## Where we are today

The shared oscilloscope helper lives in `src/modules/_shared/scope.h`. It taps a
module's float output buffer in the wrapper's `render_block` (works identically
for plain-C and Faust, since both go through the same `process_float` seam),
buckets samples into 128 columns, and serves the frame to the chain UI via a
reserved `__scope` get_param key. The chain UI (`templates/generated/ui_chain.js.eta`)
polls `__scope` and flashes the waveform; it is **style-agnostic** — the
serialized format is always 128 columns × (max-row, min-row), so style only
changes how the frame is *built*, DSP-side.

Styles available now (`capabilities.scope.style` in `module.json`, passed to
`mf_scope_init`):

| style | what it does | best for |
|---|---|---|
| `envelope` (**default**) | untriggered min/max per column | **anything** — the honest universal baseline |
| `triggered` | min/max, each frame phase-locked to a rising zero-crossing (timeout fallback) | mono, harmonic, sustained voices |
| `line` | one decimated sample per column (min==max) | simple harmonic voices; a thin-trace aesthetic |
| `none` | capture/serialize disabled | toggling the scope off while keeping the hooks |

### Why `envelope` is the default

Triggering and single-cycle line views assume **one stable, harmonic
fundamental**. That assumption holds for a subset of voices and breaks for most
categories a generic helper must serve:

- **noise / percussion** — no periodicity; the trigger can't lock and a thin
  line aliases noise into garbage. min/max correctly shows the noise band.
- **polyphony / chords** — multiple fundamentals; nothing coherent to trigger on.
- **drum / transient hits** — no sustained cycle.
- **inharmonic FM / wavefolding** (e.g. westfold at extreme settings) — no stable
  period.
- **audio FX output** (reverb/delay tails, distortion) — arbitrary content.

Untriggered min/max makes **no assumption** about the signal: it renders a saw, a
chord, a noise burst, a kick transient and chaotic FM all honestly, never goes
blank, never lies. The only cost is shimmer (which reads as "energy"). So it is
the right floor; trigger/line are opt-ins.

## The adaptive idea

Make the *default* smarter without losing the honesty floor: **attempt** a
zero-crossing trigger and **fall back** to untriggered min/max when no stable
period is found — self-tuning per signal, per frame.

### Sketch

Per frame (DSP-side, in `scope.h`):

1. Run the existing min/max envelope accumulation always (this is the honest
   substrate; it never fails).
2. In parallel, run a lightweight **period/stability estimate**:
   - track zero-crossings and the inter-crossing interval;
   - compute a stability metric (e.g. variance of recent inter-crossing
     intervals, or a cheap normalized autocorrelation peak).
3. If stability exceeds a threshold for N consecutive frames, switch the frame
   *origin* to the detected rising zero-crossing (phase-lock) — i.e. behave like
   `triggered`. If stability drops, fall back to free-running `envelope`.
4. Hysteresis on the switch so it doesn't flip every frame (the main UX risk:
   a visibly "jumping" display when hovering near the threshold).

### Open questions / risks

- **Flip-flop jank.** Crossing the stability threshold repeatedly looks worse
  than either pure mode. Needs hysteresis + a minimum dwell time in each mode.
- **Cost.** Autocorrelation per frame is heavier than the current ~140 ns/block.
  An interval-variance estimate is cheap and probably enough; measure before
  shipping (reuse `build/bench_scope.c`-style microbench).
- **Polyphony.** Even "stable" chords have a period (the LCM-ish combined
  waveform) but triggering on it may look arbitrary. May want to keep poly voices
  on `envelope` regardless — possibly a `capabilities.scope.poly_hint`.
- **Threshold tuning** is signal-dependent; expose as a constant first, consider
  per-module override only if needed.

### Why not now

The per-module `style` opt-in already covers the real cases: a subtractive voice
author writes `"triggered"`, everything else gets the honest `envelope`. Adaptive
is a quality-of-life upgrade to the *default*, not a missing capability. Build it
only if hand-picking styles proves annoying across many modules.

## Implementation pointers

- DSP: `src/modules/_shared/scope.h` (`mf_scope_t`, `mf_scope_capture`). Add an
  `MF_SCOPE_ADAPTIVE` style and the estimator state; keep the serialized format
  unchanged so the UI needs no changes.
- Metadata: the top-level `scope.style` block in each `module.def.json`. (It
  reaches the wrapper as `<ID>_SCOPE_STYLE` via the emitted
  `capabilities.scope` and `gen-params`; `module.json` is generated, so the
  authored definition is what changes.)
- UI: `templates/generated/ui_chain.js.eta` — no change required (style-agnostic).
- Solo UI: `src/modules/<id>/ui.js` overlay (westfold has one) — also unchanged.
- Tests: extend `test_scope_styles` in `tests/test_westfold_plugin.c`.

## Related, larger idea: spectrum view

For wavefolder/FM sound design, a **spectrum** (watch harmonics stack as you fold)
is arguably more useful than any scope, but it's a bigger build (FFT, different
serialization, different UI rendering). Out of scope here; noted as a future
direction.

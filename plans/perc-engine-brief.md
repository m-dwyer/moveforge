# Swarf — percussion engine implementation brief

Status: **not started, design settled.** This is the second engine in the family.
The first is `ballast` (kick / tom / sub-bass, `plans/ballast-kick-engine.md`) — read
that plan and `src/modules/ballast/dsp/ballast_core.c` before starting. Most of what
this engine needs exists there in single-voice form, and every lesson recorded there
applies here at six times the scale.

Module id `swarf`, name `Swarf`, abbrev `SWF`. Swarf is the metal swept off a lathe:
small, sharp, industrial fragments. Ballast is the ballast under the track.

## What it is

**Six note-mapped percussion voices in one module** — hats, rides, shakers, claps,
congas, toms, wood and industrial hits — for deep hypnotic and driving techno.

Every voice runs the **identical engine**. There is no per-voice algorithm, no
material selector, no mode switch. The default parameter values and the level label
give a voice its role; nothing about it is structural, so any voice can be made into
any sound.

It has to be one module because there are **four Schwung chain slots and each holds
exactly one sound generator** (`shadow_constants.h:74`, `chain_internal.h:233`).
Ballast takes one; a per-voice-per-slot design would consume the device.

## What it is *not*

**Not a kit-in-a-box.** Move's own Drum Sampler is a peer, not a fallback — Overture
sequences four Ableton engine tracks alongside the four open-engine ones. Anything
static can be rendered to a WAV and played from the sampler instead. This engine
earns its slot only by doing what a sample structurally cannot:

- respond to velocity as **timbre**, not just level
- move under Overture Route Motion (per-clip automation lanes)
- vary per hit, so sixteen consecutive hats are not sixteen copies

That is why the central control is a *continuous* material morph rather than a
material selector. A lane that turns a conga into a bell over sixteen bars is the
product. A static extreme is the thing you would have sampled.

---

# Part 1 — Blockers

**Landed.** Both are silent-wrong-answer bugs: the tooling reported success while
measuring the wrong thing, and every number measured afterwards depends on them.
What shipped is recorded under each item.

### B1. The render tools silently drop parameters past the 32nd

`tools/render_wav.c:184` declares `param_t params[32]` and `:189` stops appending at
32. Same cap in `tools/render_fx.c:157,171` and `tools/trace_midi_fx.c:70,80`. There
is no warning and no non-zero exit.

Both harnesses pass *every* parameter on every invocation — `scripts/render-stress.ts:68-70`
and `scripts/render-suite.ts:102-104` both spread the full default map into argv. At
64 parameters, parameters 33–64 sit at their `apply_defaults` values in **every stress
render and every golden render**, and `check-renders` would bless the result as
correct.

Raise the cap (256, matching the host) and **make overflow a hard error**, not a
truncation.

**Done.** One shared `mf_param_list_t` in `tools/render_params.h`, capped at
`MF_RENDER_MAX_PARAMS 256` (the host's `MAX_CHAIN_PARAMS`), used by all three tools;
overflow and an empty key both exit 2. Verified against ballast: with 35 junk
parameters ahead of it, `volume=0.0` as the 36th argument rendered at peak 7897
before the fix and peak 0 after. Covered by `tests/test_render_harness.c`.

### B2. The render suite is structurally monophonic

`tools/render_wav.c:28-34` takes a flat `notes` array and a single scalar `velocity`
for the whole render; `:131-136` fires exactly one note per step and note-offs the
previous one. No golden could ever exercise voice summing, gain staging under
simultaneity, choke, or per-voice velocity — which for a kit engine is the entire
behaviour under test.

The preset render spec needs **polyphonic steps with per-note velocity**. Suggested
shape, backward-compatible with every existing `presets.json`:

```json
"render": {
  "pattern": [
    [{ "note": 36, "vel": 110 }, { "note": 39, "vel": 96 }],
    [{ "note": 36, "vel": 64 }],
    ...
  ]
}
```

with the existing `notes` / `velocity` fields still accepted and expanded to
one-note-per-step. Keep `note_blocks`, `gate_blocks`, `seconds`, `tail_seconds` and
`automate` as they are.

**Done**, in that shape. `[]` is a rest; a bare number in a step means that note at
the render's `velocity`; giving both `pattern` and `notes` is an error rather than a
precedence rule. `velocity` may be omitted only when every note carries its own
`vel`.

The harness takes the pattern in the existing positional notes slot rather than
behind a new flag, because the old CSV is exactly the subset of the new grammar with
one note per step: steps separated by `,`, simultaneous notes by `+`, velocity after
`:` (`36:110+39:96,,36:64`). Grammar and rationale in `tools/render_pattern.h`;
malformed specs exit 2 rather than rendering a shortened pattern. All 16 ballast
renders are byte-identical across the change, and re-spelling one of them as an
explicit `pattern` reproduces the same bytes again.

Note-off behaviour generalises the monophonic version exactly: a step releases the
previous step's notes before firing its own, step 0 still leaves the wrap-around
predecessor held, and the `gate_blocks` release now covers every note in the step.

---

# Part 2 — Prerequisites

Ordered. Each is known-wrong-by-construction or known-missing today.

### P1. One shared "walk levels in declaration order" helper

Six scripts read `levels.root` only, and would leave every parameter outside `root`
registered by the host and answered by nothing — dead knobs with no local symptom:

| script | line |
|---|---|
| `scripts/gen-params.ts` | `:66` |
| `scripts/gen-presets.ts` | `:44` |
| `scripts/gen-ui-chain.ts` | `:71`, `:123` |
| `scripts/render-stress.ts` | `:47` |
| `scripts/validate-params.ts` | `:197`, `:215` |
| `web/src/module-metadata.ts` | `:145` |

Only `validateHostLimits` (`validate-params.ts:246-310`) walks all levels today.

Write **one** helper that flattens `capabilities.ui_hierarchy.levels` in declaration
order and have all six call it. Not six copies — `web/src/module-metadata.ts:148`
uses the array index as the `ParamDefinition.id` sent to the worklet, and that index
must equal the generated `SWARF_PARAM_*` enum ordinal. Two independent walks that
drift produce a module whose browser knobs address the wrong parameters.

**Done.** `shared/ui-hierarchy.ts` — `flattenParams`, `flattenKnobs` and
`paramGroups`, with `flattenParams` defined in terms of the groups so a caller that
wants bank structure (P7) cannot walk the hierarchy a second, differently-ordered
time to get it. All seven sites call it, `validateHostLimits` included, so the count
the validator checks and the count the C is generated from cannot disagree. New
top-level `shared/` for TypeScript both trees need; the browser reaches it fine
(`vite build` bundles it, dev serves it at `/@fs`).

Two things the upstream source settled that this section did not anticipate:

- **`shared_params` flattens first**, not last — `parse_hierarchy_params` parses it
  at `chain_params.c:447`, before it has looked at `levels` at all (`:493`).
- **Integer-like level keys are rejected.** The host's order is the JSON *text's*;
  JavaScript enumerates array-index keys first in numeric order, ahead of every
  string key, so `{"hat":…,"2":…,"oh":…}` reaches the host as hat, 2, oh and
  `Object.entries` as 2, hat, oh. **So key the eight levels `hat`, `oh`, `ride`,
  `clap`, `conga`, `wood`, `kit`, `map`** and put "1 Hat" in each level's `name`,
  which is what Part 5's bank row reads anyway. The walk throws rather than let a
  numeric key through, and `gen-params` and `validate` both exit 1.

Also settled: `root` is not a special name to the host, so nothing about the
existing modules was non-conformant — the ceiling was in the generators. Splitting
ballast's 16 params into two levels leaves all four generated files byte-identical,
which is the property Part 5 depends on: grouping is presentation, not structure.

### P2. Sparse presets inherit defaults

`scripts/gen-presets.ts:75-79` throws if any preset omits any key;
`validate-params.ts:420-423` reports the same first. Sixteen kits × 64 parameters is
1024 hand-authored numbers, and every parameter added later means editing all sixteen.

The generated C is already a dense `float[PARAM_COUNT]` table applied wholesale, so
"inherit default" and "explicitly equals default" produce identical output — no
runtime or ABI change. Roughly four lines:

- `gen-presets.ts:11` — widen `type Param` to carry `default` (already present in the
  object being read at `:43`)
- `gen-presets.ts:75-79` — `const value = preset.params?.[p.key] ?? p.default;`, keep
  the throw only for a non-numeric *present* value
- `validate-params.ts:420-423` — drop the missing-key error, keep the range check at
  `:424-430` and the unknown-key check at `:417`
- `web/src/components/Controls.tsx:39` and `audio.ts:67` already do `?? p.default`

Add alongside it: warn when a preset omits a key that the *previous* preset set.
Sparse presets make "I forgot voice 5" invisible otherwise.

**Done**, and it was six sites rather than four, because "inherit the default" is a
rule with three consumers that have to agree — the same shape as P1. It lives in
`shared/presets.ts` (`presetValue`, `densePresetValues`,
`keysDroppedFromPreviousPreset`), called by `gen-presets`, `render-suite` and the
browser store.

The two the bullets above did not name:

- **`web/src/store.ts` `applyPreset` / `applySlotPreset` wrote only the keys a preset
  names.** The `?? p.default` sites the brief cites are *reads* of a param's current
  value; these are the writes. On device `<id>_apply_preset` writes the whole dense
  table, so switching to a sparse preset would have left the previous preset's values
  behind in the browser and nowhere else. Both now apply the dense set. Two tests in
  `web/tests/store.spec.ts`, both red against the old behaviour.
- **`render-suite.ts` passed only the preset's own keys**, so a sparse preset would
  have leaned on `apply_defaults` rather than passing the value. Same number either
  way (validate enforces that), but it costs six lines to keep "every render passes
  every parameter" true, which is the premise that makes the 256-param cap the thing
  under test. Checked: a 15-key ballast preset now sends 16 `key=value` args, the
  omitted `curve` at its declared 0.

A present-but-non-numeric value is an error naming the preset, the key and the
default it could have inherited; an out-of-range value is passed through, because the
validator reports it and the generated `set_param` clamps it.

Verified by stripping every default-valued key out of ballast's presets.json — 45 of
256 across 16 presets — and confirming `ballast_presets.gen.inc` and all 16 suite
renders come back **byte-identical**, with the dropped-key warning firing on exactly
the 4 presets that stop setting a key their predecessor set. 18 unit tests in
`tests/presets.test.ts`; every mutation tried goes red.

### P3. Stress-harness fixes

All in `scripts/render-stress.ts` unless noted. Every one of these currently produces
a green run that tested nothing.

- **`:116` the "Hot Fast" regex is unanchored**, so `hat_level` and `conga_grit` are
  swept alongside `volume`. Combined with "All Max" at `:109` this maxes all six
  voices plus master, and `check-stress.ts:53` (any clipped sample) and `:55`
  (`peak > 0.995`) will fail. Anchor it.
- **`:131` the velocity regex `/^(vel|velocity)(_|$)/i` is anchored**, which is
  correct for this module's global `vel_depth` — verify it still matches after
  naming, because a miss silently reinstates the exact regression the comment at
  `:125-129` exists to prevent.
- **`:66` the note list is hardcoded to `"36,43,48,55,60"`.** With voices on 36–41,
  voices 2–6 are never triggered and ~18 of their cases render identically to
  Default. Derive the note list from the module, or extend it.
- **`:161` `isSilencingParam` and `validate-params.ts:312-320`
  `validateSoundGeneratorLevelParams` both use anchored `/^(volume|level)$/i`**, so
  `hat_level` is neither required to have `min: 0` nor recognised as silencing.
- **Case count is `2N + 5`** (`:98-144`) — ~125 renders at N=64, ~110 MB per run at
  5 s each (`:65`). Cap or group. Nobody listens to 125 WAVs, so the metric gates
  become the only real check and they need to be trustworthy.

### P4. Per-voice RNG seeding

`ballast_init` does `mf_rng_init(&s->rng, 0x8A11A57u)` — a per-module constant. Fine
for one voice and good for reproducible renders. Six voices sharing it draw the
**identical noise sequence**, so they sum coherently at +15.6 dB instead of +7.8 and
six hits sound like one loud hit. Seed from a constant mixed with the voice index.
Stays deterministic, so renders stay reproducible.

### P5. Excitation and resonator primitives into `_shared`

Two new blocks in `src/modules/_shared/mf_dsp.h`, with coverage in
`tests/test_mf_dsp.c`. Both are described in Part 4.

- **`mf_exciter_t`** — noise source with decimation density, burst scheduler, and
  excitation envelope. Ballast folds its click into `punch` and hard-codes a 1500 Hz
  highpass; this engine is *entirely* excitation, so noise level, density, burst
  structure and envelope all have to be first-class.
- **`mf_reson_t`** — a two-pole resonator parameterised by **T60 directly**, not by a
  normalised resonance. `MF_SVF_Q_MAX` is 25, which caps T60 at ~275 ms at 200 Hz and
  ~9 ms at 8 kHz — far too short for anything metallic. The SVF is the wrong primitive
  for a partial bank and no amount of knob mapping fixes it.

### P6. Promote the two-stage envelope to `_shared`

Ballast crossfades a parallel exponential and linear envelope by `shape` (the
`amp_exp` / `amp_lin` pair in `ballast_core.c`). It was deliberately left
un-extracted until a second engine needed the same thing — it now does. Retaper as
part of promoting it: `shape` puts ~70% of its effect in its first tenth.

### P7. Bank names in `ui_chain.js`, groups in the web UI

`templates/generated/ui_chain.js.tmpl:85-135` already implements encoder banks of
eight, and shows a bank-select row plus the current bank's eight parameters when
`pageCount() > 1`. It labels the row "Encoder Bank". Emit a `BANK_NAMES` array from
the level names so it reads "2 OpenHat".

`web/src/components/Controls.tsx:65-81` renders one flat grid. 64 undivided sliders
is ~1600 px of unbroken list, and the browser is where the sound design actually
happens. Render one group header per level.

### P8. `bsearch` parameter dispatch

`scripts/gen-params.ts:169-171` emits a linear `strcmp` chain. It runs on the audio
thread: the host's smoother re-issues `set_param` per active parameter per block
(`chain_host.c:1975-1985`), capped at 16 concurrent (`chain_internal.h:206`), so 64
parameters is a worst case of ~960 `strcmp`s per block against a 2902 µs quantum.
Not fatal, but the wrong shape, and `tools/render_timing.h:145` fails a render
outright when the third-slowest block reaches the quantum.

Emit the keys sorted with their enum ids and `bsearch` — ~6 `strcmp`s worst case,
naming-agnostic, and the generator change is a `.sort()` plus a different template
block. Nothing parses the generated lookup (`validate-params.ts:103` compares bytes
after re-rendering). The template's `{{idLookup}}` slot widens from a statement list
to a function body, and `<string.h>` needs to be included explicitly rather than
inherited.

---

# Part 3 — Hard constraints

**Read `skills/schwung-dsp-development/SKILL.md` rule 6** — a table of constraints
verified against upstream Schwung `a20cacd1` / v0.11.4, with sources. Do not
re-derive them. Also read its **traps** section; every entry is a bug that shipped in
Ballast and was caught by review rather than the compiler, and at least six apply
directly here.

The ones that bite hardest:

- **~150–225 µs per slot per 128-frame block.** Ballast uses ~3 µs on a dev machine.
  Six voices is a different proposition — see Part 7.
- **Peak near −12 dBFS**, defined at the **module output with voices summing** — see
  Part 6. Four slots sum at unity into one int16 mailbox with no limiter anywhere
  after them.
- **Schwung's idle gate needs a full second under −78 dBFS**, so it never fires inside
  a running groove. Per-voice early-out is this module's own job.
- **Nothing clamps between FX stages** — an overshoot wraps rather than clips.
- **MIDI is block-quantised (~2.9 ms) with no sample offset.** Latency is not fixable.
  Simultaneity is — see Part 8.
- **Plain C, not Faust.** `AGENTS.md` says Faust is the default for new sound
  generators; it is wrong for this one, and the Ballast plan already recorded why:
  Faust cannot skip work, and per-voice early-out, trigger-time state reset and
  dirty-flagged coefficients are all control flow it does not express. Do not
  scaffold with Faust and do not create `swarf.dsp`.

### Host limits

- **256 parameters per component**, parameter keys ≤ **31 bytes**, names ≤ **63
  bytes**, `module.json` < **65536 bytes**. At 64 parameters module.json lands around
  16–18 kB. Comfortable.
- **Only `float` / `int` / `enum` types parse**, and Overture ignores `enum` option
  labels, so use `int` for discrete selectors. Names live in `metadata.json`.
- **Duplicate parameter keys leave the module with no parameters at all.**
  `parse_hierarchy_params` returns −1 (`chain_params.c:531-541`), but the caller falls
  through to the legacy path, sets `*count = 0` and returns success (`:578`,
  `:587-603`); `chain_host.c:490` only fails on `< 0`. **The module loads normally
  with zero parameter metadata** — 64 dead knobs — rather than failing to appear.
  Prefix every voice parameter.

  `scripts/validate-params.ts` used to claim the module is rejected and does not
  appear; its comment block now records the real behaviour and the fall-through that
  produces it. Trust the comment, not any older note.

---

# Part 4 — The voice

One topology, six instances. Roles come from defaults, not from code.

```
note on
   │
   ├─ trigger offset (0–3 ms, deterministic per voice, scaled by `human`)
   │
   ▼
EXCITATION  ── mf_exciter_t
   noise → decimation (density d) → burst scheduler (1–4 bursts) → excitation env
   │
   ├──────────────────────────────────────────────┐
   ▼                                              │  (1 − body)
PARTIALS
   mat < 0.25 : tuned comb (delay + damping + feedback)
   mat ≥ 0.25 : 6 × mf_reson_t at f0 · ratio_k(mat), T60_k, gain_k
   crossfaded across 0.20–0.30
   │  (body)                                      │
   ▼                                              ▼
   └──────────────── mix ─────────────────────────┘
   │
AMP ENV      two-stage exp/lin crossfade by global `shape`, decay from `decay`
   │
FILTER       one SVF, `tone` as a monotone brightness sweep
   │
DRIVE        `grit` into the global `curve`, normalised by this voice's amp env
   │
LEVEL / PAN  `level`, equal-power pan from index × global `spread`
   │
   ▼  accumulate into the stereo bus
```

### Partial bank

`SWARF_PARTIALS` two-pole resonators, **sized 10 and skipped aggressively** — see
"partial skipping" below and the note on bank size at the end of this section.
`f_k = f0 · ratio_k`, and per partial:

```c
r    = expf(-6.9078f / (T60_k * sr));        /* -60 dB over T60_k          */
w    = MOVEFORGE_TWO_PI * f_k / sr;
a1   = 2.0f * r * cosf(w);
a2   = -r * r;
b0   = sinf(w);                              /* unit peak from an impulse  */
y    = b0 * x + a1 * y1 + a2 * y2;
```

Starting points, to be settled by measurement:
`T60_k = decay · (f_1 / f_k)^tilt` with `tilt = 0.5` (higher partials die faster,
which is what struck objects do), `gain_k = 1/(k+1)` normalised so `Σ gain_k = 1`.

**`tilt` almost certainly needs to be a function of `mat` rather than a constant, and
that is the first thing to measure.** A drum head damps strongly with frequency; a
metal plate barely does. A fixed positive `tilt` strips the top off a long hit, which
turns a ride into a bell ping — the thing this bank is least naturally good at. Don't
pre-commit to an exponent here; plot the decay-time-versus-frequency profile of a
metal-end voice and pick from the plot. See the wash gate in Part 9.

Impulse-excited, a resonator *is* a decaying sinusoid. Noise-excited it is a noise
band. Same code, same coefficients — that single fact is what collapses "sustained
metal cluster" and "struck modal body" into one primitive, and it is why there are no
oscillators in this engine.

**`mat` — the flagship control.** A continuous morph of the ratio set through five
anchors, linearly interpolated per partial between adjacent anchors:

| `mat` | anchor | is |
|---|---|---|
| 0.00 | comb | wood, block, pipe, plastic, plucked |
| 0.25 | harmonic | tonal perc, tuned tom |
| 0.50 | membrane | conga, bongo, tom, snare body |
| 0.75 | 808 cluster | hats, dense metallic buzz |
| 1.00 | free bar | rim, block, bell, ride |

```c
/* Ratio anchors, 10 partials. A zero means the anchor has no partial there and
 * the interpolation fades one in from the neighbouring anchor. */
harmonic  1, 2,     3,     4,     5,      6,      7,      8,      9,      10
membrane  1, 1.593, 2.136, 2.295, 2.653,  2.917,  3.156,  3.500,  3.598,  3.647
cluster   1, 1.447, 1.617, 1.927, 2.503,  2.664,  0,      0,      0,      0
free_bar  1, 2.757, 5.404, 8.933, 13.345, 18.638, 24.814, 31.872, 0,      0
```

Membrane ratios are the ideal circular membrane's `j_mn / j_01`; free-bar ratios are
`(β_n/β_0)²` for the ideal free-free bar; the cluster is the 808 hi-hat's six
oscillator ratios, and it has exactly six because the circuit has six oscillators —
padding it with invented partials would make it something other than the thing it is
named after.

Every intermediate position is a plausible inharmonic percussion timbre, so the knob
is sweepable end to end with no dead zone and no mode switch. This is the answer to
"why not the Drum Sampler".

**Why a comb at the bottom rather than a sixth ratio set.** A comb is infinitely many
harmonic partials and gives long tuned decays for almost nothing; six resonators at
harmonic ratios is a thin imitation that loses the hollow/plastic/pipe character
entirely. Delay line of 2048 floats per voice (~48 kB total, calloc'd once at
instance creation), linear interpolation, one-pole damping in the feedback path,
feedback set from `decay`.

The comb-to-bank transition is a structural seam and a crossfade, not a morph. It
sits between "dense harmonic" and "sparse harmonic" — the smallest perceptual gap on
the whole axis, which is the right place to hide it. Both are driven from the same
`f0`, so the crossfade stays musical.

**Aliasing.** Six clustered sines through `MF_DRIVE_CLIP` or `MF_DRIVE_FOLD` produce
exactly the dense inharmonic intermodulation spectrum that makes an 808 hat, which is
why this engine needs no oscillators. It also aliases. Ballast deferred oversampling
on a measurement (hard-clipped 55 Hz put folded energy around −52 dB and falling, and
a cheap half-band would have attenuated by about the same amount). **Make the same
measurement here** against a bright driven hat with `tune` swept, and decide from the
number. Do not assume either way.

**Partial skipping is load-bearing, not an optimisation.** Skip any partial with
`f_k > 0.45 · sr` or `gain_k` below −60 dB relative. Muting rather than folding also
stops a `tune` sweep from generating aliased partials that move *downward* as the
knob goes up.

**On bank size.** A conga needs three partials, a hat six, a ride as many as it can
get — modal density is most of what separates a cymbal from a bell. The bank is sized
**10** because the anchor tables above are the expensive part to get right and they
cost nothing to write once, while extending them later means re-deriving four sets of
ratios and re-measuring CPU. Skipping keeps the average cost near the old six-partial
figure; the worst case is in Part 7 and it is the number to watch.

`SWARF_PARTIALS` is a compile-time constant. If measurement says 10 is more than the
budget can carry, lowering it is a one-line change and the tables stay correct.

### Excitation — `strike`

`strike` is bipolar around 0.5. The axis is **how the hit's energy is distributed in
time**: many small stochastic events on the left, one clean event at centre, few
large deterministic events on the right.

Let `s = (strike − 0.5) · 2`, so `s ∈ [−1, +1]`.

- **`s < 0` — rattle.** The noise source is decimated to a sparse impulse train,
  density falling from continuous at `s = 0` to roughly one impulse per 500 samples at
  `s = −1`, and the excitation envelope lengthens from ~1 ms to ~120 ms. Shaker,
  cabasa, tambourine, wash.

  The 120 ms is a starting point, and the other candidate is letting it reach the
  **full amp decay** at `s = −1`. That matters beyond shakers: a resonator that is
  driven continuously produces a noise *band* rather than a decaying sine *line*, and
  a bank of bands is a wash where a bank of lines is a chord. It is the same axis
  either way — "many small events spread in time", spread as far as the hit lasts —
  so it costs nothing to try. Decide it from the wash gate in Part 9, not from here.
- **`s = 0` — one strike.** Excitation envelope ~0.5–3 ms.
- **`s > 0` — burst cluster.** Up to three extra bursts after the first. Fade them in
  by *level*, not by count, or the knob steps: burst `k` (k = 1..3) has level
  `clamp(s·3 − (k−1), 0, 1)`. Spacing interpolates 25 ms at `s → 0` down to 6 ms at
  `s = 1`, with each burst ~2 dB below the last. Flam → ratchet → clap.

The clap's tail comes from the amp envelope, not the burst scheduler — `decay` plus a
`shape` toward linear gives the room behind the hands.

This one control absorbs both the grain density and the burst structure. It is the
cleverest thing in the design and therefore the most likely to need revising: if it
does not test well, split it into a per-voice `grain` and a global
`burst_voice` / `burst` pair, and demote something else from the per-voice eight.

### Filter — `tone`

One SVF per voice, used as a monotone brightness sweep so the knob never reverses:

- `tone < 0.5` — lowpass, cutoff 300 Hz → 20 kHz as `tone` goes 0 → 0.5
- `tone ≥ 0.5` — highpass, cutoff 20 Hz → 12 kHz as `tone` goes 0.5 → 1

Continuous across the centre (a 20 kHz lowpass and a 20 Hz highpass are both
transparent). Q around 1.2, fixed — a slight corner emphasis is what makes a hat sit.
Resonant colour comes from the partial bank; this control is brightness only. Pick
`lp` or `hp` from the SVF per block, not per sample.

### Drive — `grit`

Per voice, into the globally selected `curve`. **Normalised by that voice's amp
envelope**, floored at 0.12, exactly as Ballast does: distort `y / env` and reimpose
`env` after. Ballast measured crest factor collapsing from 11.9 dB to 1.9 dB with a
426 ms flat top under a static pre-gain — a square wave, not a drum.

Per-voice rather than global is **structural, not a nicety**: the 808-hat density
comes from clipping the clustered partials, so a global drive would make the hats
metallic by also driving the conga.

---

# Part 5 — Parameters and UI

**Six voices × 8 parameters + 16 globals = 64**, declared as **eight named
`ui_hierarchy` levels** which the generators flatten in declaration order (P1). Each
level is exactly eight parameters, so **one level is one encoder bank** on the Move.

```
bank 1  [ 1 Hat      ]  tune  decay  mat  body  tone  strike  grit  level
bank 2  [ 2 OpenHat  ]  ⋯ same eight
bank 3  [ 3 Ride     ]
bank 4  [ 4 Clap     ]
bank 5  [ 5 Conga    ]
bank 6  [ 6 Wood     ]
bank 7  [ Kit        ]  volume  drive  curve  tone  shape  human  vel_depth  spread
bank 8  [ Map        ]  root  chrom  choke  kit_decay  bright  warp   ·  ·
```

Jog to the bank row, pick a voice, and the eight encoders are that voice's eight
knobs. Names are **defaults plus a label**, not structure: "1 Hat" is a voice whose
defaults happen to be `mat 0.75`, high `tune`, short `decay`, low `body`. Turn `mat`
down and `decay` up and it is a conga, and the label still says Hat. Number-prefixed
so a retasked voice is still identifiable by position. That is the one deliberate
dishonesty in the design; on a 128×64 screen a meaningful label beats a correct one.

Two slots in bank 8 are deliberately empty. Hold them for what measurement turns up
rather than inventing parameters to fill a grid.

### Per-voice parameters, ×6

Key prefixes `hat_`, `oh_`, `ride_`, `clap_`, `conga_`, `wood_`. Longest key is
`conga_strike` at 12 bytes, well inside 31.

| key | type | range | notes |
|---|---|---|---|
| `tune` | float | 24–108 semis | fundamental `f0` of comb and partial bank |
| `decay` | float | 0.005–4 s | **exponential taper** — see below |
| `mat` | float | 0–1 | material morph, five anchors |
| `body` | float | 0–1 | excitation ↔ partials blend |
| `tone` | float | 0–1 | brightness, bipolar LP↔HP |
| `strike` | float | 0–1 | excitation time-structure, bipolar |
| `grit` | float | 0–1 | drive amount into the global `curve` |
| `level` | float | 0–1 | voice level |

**`decay` diverges from Ballast deliberately.** Ballast is linear in seconds so a
Route Motion lane stays linear in time. Percussion spans 5 ms to 4 s — three orders
of magnitude — and linear would put every hat in the bottom 5% of travel. Exponential,
and a decay sweep then reads as linear in *perceived* length, which is what the lane
is for.

### Globals

| key | type | range | notes |
|---|---|---|---|
| `volume` | float | 0–1 | master, `mf_smooth_init_gain(15, 5)` |
| `drive` | float | 0–1 | bus drive, static pre-gain — see Part 6 |
| `curve` | int | 0–4 | shared saturation curve, the cohesion lever with Ballast |
| `tone` | float | 0–1 | bus tilt, ±12 dB, pivot 1500 Hz |
| `shape` | float | 0–1 | kit-wide amp envelope, exponential → linear |
| `human` | float | 0–1 | per-hit variation depth |
| `vel_depth` | float | 0–1 | velocity → timbre depth |
| `spread` | float | 0–1 | stereo width |
| `root` | int | 0–96 | base MIDI note of the voice block, default 36 |
| `chrom` | int | 0–6 | chromatic-zone voice, 0 = off |
| `choke` | int | 0–2 | 0 off, 1 voices 1–2, 2 voices 1–3 |
| `kit_decay` | float | 0–1 | macro: scales every voice's decay, 0.25× to 4× |
| `bright` | float | 0–1 | macro: bipolar offset to every voice's `tone` |
| `warp` | float | 0–1 | macro: bipolar offset to every voice's `mat` |

The three macros exist for Route Motion. One lane that opens every decay in the kit
over eight bars is a move the per-voice controls cannot make.

### Why levels at all, given they flatten

The device UI for a **sound generator** never uses the built-in hierarchy editor. The
chain host caches `ui_hierarchy` from module.json only for FX and MIDI FX; for a synth
it calls `get_param(inst, "ui_hierarchy")` (`chain_host.c:1507-1574`), which no
moveforge module answers, so it falls back to `ui_chain.js`, which owns the whole
screen (`shadow_ui.js:7495-7509`, `:15161-15176`). Overture flattens named levels too.

So levels buy no navigation today. They buy: a legible module.json, bank names on the
Move, group headers in the browser, correct handling in Overture, and the structure
already being in place if serving `ui_hierarchy` from `get_param` is ever worth
trying. That last path is untested in this repo and is **not** part of this work.

**Never use `child_prefix` / `child_count` / `child_label`.** Schwung's shadow UI
implements it; Overture does not, and gets it silently wrong — it would emit
`synth:decay` where the DSP expects `synth:hat_decay`, correct-looking in the browser
emulator and broken on device. Named levels flatten correctly in both hosts today
(`overture-next/src/host/schwung-chain-reader.ts:142-146`).

### The core struct must be flat

`validate-params.ts:580-587` requires a literal `float <key>;` in `swarf_core.h` for
every parameter. It cannot see `struct voice { float tune; } v[6]`.

So: **64 flat float fields named exactly as the keys**, and a per-voice gather. Build
a `float *vp[6][8]` pointer table once in `swarf_init`, or copy each voice's eight
values into a local struct at the top of its per-block section — eight loads per voice
per block, which is nothing. Voice *state* (resonator memories, delay line, envelopes,
RNG) lives in a proper `swarf_voice_t[6]`; only the parameter storage is flat.

### metadata.json

`validate-params.ts:330-334` makes a `randomize` entry **mandatory for every
parameter** — 64 of them, each needing `min` / `max` inside the declared range,
`min < max`, and a `mode` of `around_default` | `bounded` | `full`. Tooltips under
`params` are optional but expected; write all 64.

Six voices share the same eight hints, so a per-level or prefix default in the
validator would remove 40 duplicated blocks. Optional, and a good candidate if the
duplication becomes a maintenance problem.

---

# Part 6 — Gain staging

**The −12 dBFS reference is a property of the module output with voices summing.** Six
voices each peaking at −12 dBFS sum to roughly 0 dBFS, and nothing clamps between
stages, so it wraps rather than clips. Each voice inside therefore sits around −17 to
−18 dBFS, which is also musically correct: a kick should be louder than a hat.

Calibrate `SWARF_OUT_TRIM` so the **loudest kit preset, driven by its own render
pattern at velocity 127, peaks near −12 dBFS**. Keep per-voice trim low enough that a
normal two- or three-voice sum stays under `MF_SOFT_LIMIT_KNEE` (0.75), so the limiter
catches faults rather than doing the gain staging. Ballast learned this the other way
round: moving its first limiter below the output gain spread preset peaks from ±0.9 dB
to 6.5 dB.

### Bus

Stereo, because per-voice pan survives to the device output (verified: `render_block`
writes interleaved L/R straight into the chain buffer and every stage downstream is
index-wise — `chain_host.c:2015-2016`, `:2031-2055`, `schwung_shim.c:1657-1685`,
`:2397-2445`; Schwung has no pan concept of its own). Run both channels through:

```
voice sum → tilt (`tone`, pivot 1500 Hz, ±12 dB)
          → bus drive (`drive`, global `curve`)
          → mf_dcblock_tick
          → mf_soft_limit                 (at unity, upstream of the gain)
          → × volume × SWARF_OUT_TRIM
          → declick add
          → mf_soft_limit
          → mf_sanitize
```

**The bus drive is deliberately a static pre-gain**, unlike the per-voice one. On a
sum with a hit every sixteenth the level is roughly continuous, so it behaves as drum-
bus glue rather than as the infinite-ratio limiter Ballast measured on a single
decaying voice. Two different jobs, two different behaviours, both labelled honestly.

### One bus declick, not six

Because MIDI is block-quantised, every retrigger lands on sample 0 of a block. So a
single bus-level declick captures the total discontinuity correctly no matter which
voice caused it, at one float per channel.

Keep both of Ballast's subtleties: it must sit **downstream of the gain that steps**
(here, the bus gain — the per-voice velocity step reaches the bus intact), and it must
**not seed from silence** or it cancels the attack. Ballast measured every `phase`
setting producing the same first sample without that guard.

Choke does *not* use the declick — it is an ~8 ms release ramp, which is continuous by
construction.

---

# Part 7 — CPU

Estimate: six voices × ten resonators ≈ 120k operations per block, roughly **80 µs on
device** against a 150–225 µs slot budget. That is the absolute worst case — all six
voices sounding simultaneously with every partial in range, which no real kit does —
and skipping puts the typical figure nearer 50 µs. Still ~15–25× Ballast, and
extrapolated from a dev machine, so it is a measurement and not an assumption. If it
does not fit, `SWARF_PARTIALS` is the dial.

The lever is not voice count. It is this:

> **No `sinf` / `powf` / `expf` / `tanf` inside the sample loop.**

Ballast's 3 µs is dominated by a per-sample `sinf`. This topology has none — the
resonators, comb, noise, envelopes and `mf_tanh_approx` are all cheap. Everything
transcendental belongs in the per-block coefficient section.

Then:

- **Per-voice early-out.** An idle voice accumulates nothing into the bus, so it costs
  literally nothing — not even a `memset`. Render into a stack `float bus[128][2]` and
  have active voices add into it.
- **Module-level early-out** when all six voices are idle *and* the bus state has
  settled. Include the DC blocker's state in the idle test, as Ballast does, or the
  filter's tail is truncated.
- **Dirty-flagged partial coefficients.** Six `cosf` + six `sinf` + six `expf` per
  voice per block is ~4 µs if recomputed unconditionally. Recompute only when `tune`,
  `decay`, `mat`, `kit_decay` or `warp` changed for that voice.
- **Partial skipping** above Nyquist and below −60 dB (Part 4).
- **Denormals.** Offline and WASM run with denormals live (`FPCR.FZ` is device-only,
  `schwung_shim.c:4230-4241`). Six voices × six resonators is 36 recursive states plus
  filters and delay lines; `mf_flush_denorm` on all of them is ~2–3 µs and is not
  optional.

**Trap T1 applies six times over.** An idle early-out freezes anything smoothed inside
the sample loop, and Ballast muted with the transport stopped still fired its whole
transient at −13 dBFS on every hit, forever. **Snap every ramped control on note-on,
per voice.** A test that changes a control on a *sounding* voice cannot catch this —
it takes the smoothed path.

---

# Part 8 — Notes, choke, and per-hit variation

### Note mapping

Notes both select a voice and carry pitch, and the brief this replaces never resolved
the collision.

- `root` … `root + 5` trigger voices 1–6 at their own `tune`. Default `root` 36.
- Notes ≥ `root + 12` play the voice selected by `chrom` chromatically, tracking
  relative to middle C. `chrom = 0` disables the zone.

That preserves what Ballast's `track` was for — tuned tom and conga runs, melodic
percussion — without a mode switch, and it keeps `root` free to move the block out of
the way of another module's mapping.

### Choke

The old brief claimed mono voices give hat self-choke for free. **They do not** — if
closed and open hats are separate voices, a closed hat retriggering does nothing to
the open hat. Cross-voice choke needs an explicit group:

- `choke = 0` — off
- `choke = 1` — voices 1–2 are a group (closed / open hat)
- `choke = 2` — voices 1–3 are a group (adds the ride)

A trigger on any member ramps every other member down over ~8 ms. Not an instant cut,
which clicks, and not the declick, which is for retrigger steps.

Each voice is mono and there is **no voice allocator** — notes map to voices, all six
are always available. That removes a whole class of bug the old brief's "3–4
simultaneous voices" would have introduced.

### Per-hit variation

`human` drives, per voice, per hit, from that voice's own RNG (P4):

- detune, decay, drive and level jitter — Ballast's ±30 cents / ±15% / ±20% / ±10% is
  the template, but hats want more decay and tone variation and less pitch than a kick
- **stereo position jitter**, ±0.15 × `spread`
- **trigger micro-offset, 0–3 ms.** MIDI's block quantisation means two voices
  triggered on the same step are *sample-exactly* simultaneous, which is much of what
  reads as machine-like. A deterministic per-voice offset costs one counter per voice
  and turns the limitation into expression. Latency is still not fixable; simultaneity
  is.

Per-hit variation is the one thing a host LFO structurally cannot do, which is why it
lives in the module and a general-purpose LFO does not.

### Velocity

Ballast's laws, generalised. `vel_gain` linear in velocity; pitch and drive at
reduced depth; and **noise and excitation layers scale by velocity *squared***.
Ballast measured its spectral centroid running backwards — 180 Hz at velocity 0.25
down to 146 Hz at full — until the noise layers were steeper than level. That is the
opposite of how a struck object behaves, and it is most of why velocity reads as a
level control rather than an expressive one.

Every voice must be checked, not just one. See Part 9.

---

# Part 9 — Verification

`mise run check` must exit 0. Beyond that:

**Write measurement probes, don't judge by ear alone.** Small standalone C programs
against the core, compiled into a temp directory, reporting crest factor, attack-band
level relative to peak, decay time, spectral centroid, µs per block. Every design
decision in Ballast was settled by a number; see that plan's "Measured" sections.

**Mutation-test every assertion.** Several tests in this repo passed with the feature
they named compiled out — the shared drive suite passed with three of five curves
replaced by `return x`, and a declick test passed with the declick removed. Break the
implementation, confirm the test goes red, restore. Save a copy first: `git checkout`
also discards uncommitted work.

**Absolute references belong in C, not in goldens.** Goldens only ever say
"unchanged"; a bless can walk a reference away.

### Assertions this engine specifically needs

- **Gain, two ways.** Loudest single voice at velocity 127; and **all six voices
  triggered on the same block** at velocity 127 on the loudest preset. Both in C, not
  only in goldens.
- **Per-voice loudness balance within a kit.** Ballast's finding was that *perceived
  loudness* spread (5.3 dB, down from 10.0) separated the good preset set from the bad
  one, not peak spread. The analogue here is the balance between voices inside one
  kit — measured and chosen, not eyeballed.
- **Velocity → spectral centroid monotonically increasing**, for **every voice** at
  its default material, across velocity 1–127. Ballast's regression, ×6.
- **Consecutive hits differ.** Render sixteen hats; assert the spectral distance
  between consecutive hits exceeds a threshold with `human > 0`, and that renders are
  bit-identical with `human = 0`. This is the module's stated reason to exist, so it
  gets an asserted number.
- **The wash gate.** A metal-end voice (`mat` ≥ 0.75, long `decay`) must still have
  energy up top well into its tail: assert the 4–10 kHz band retains a stated fraction
  of its initial level at 500 ms, and that a membrane-end voice does *not*. Plot the
  decay-time-versus-frequency profile alongside it.

  This gate exists because a thin ride is invisible to every other check — no
  clipping, no DC, no NaN, goldens stable — so a bell-ping ride blesses cleanly and
  ships. It is the same shape of blind spot as the drive suite passing with three of
  five curves replaced by `return x`. Pick the threshold from the first plot of a
  known-good reference, then mutation-test it by flattening `tilt` and confirming it
  goes red.

  The levers, in the order to try them: make `tilt` a function of `mat` (Part 4);
  extend the excitation to the full decay at `strike = 0` (Part 4); add a small
  per-partial frequency shimmer at the metal end — ±8 cents at 3–7 Hz, per-partial
  phase, updated per block by the small-angle approximation
  (`cos(w+δ) ≈ cos w − δ·sin w`) so it costs four multiplies rather than two
  transcendentals; raise `SWARF_PARTIALS`. Measure after each, and stop when the gate
  passes rather than applying all four.

- **Per-voice early-out actually skips.** Count the voices that ran the sample loop,
  not just that the output was silent.
- **No partial above `0.45 · sr` contributes**, at the top of the `tune` range.
- **Choke.** The open hat's tail reaches silence within N ms of a closed-hat trigger,
  and no sample-to-sample step in the process exceeds the signal's own slew by more
  than a small factor.
- **Block-boundary discontinuities**, measured *between* the last sample of one buffer
  and the first of the next. Ballast's trap T4: a loop starting at `i = 1` inside the
  post-trigger buffer never looks at the pair that matters, and passes with the
  feature deleted.
- **CPU with all six voices sounding**, not one. The render harness already prints µs
  per block; store it in the golden metrics so a regression is visible to CI. That gap
  is called out in the Ballast plan and this is the engine that needs it closed.

---

# Part 10 — Presets

Presets are **kits**, and this matters more than it did for Ballast.

**The defaults are the flagship kit.** `module.json`'s declared defaults are the
power-on state, and the host seeds its knob positions from the same numbers, so they
must be a complete, balanced, immediately-good techno kit rather than neutral values.
This is true regardless of the preset situation below.

**What actually happens to presets on device** — narrower than it is usually stated,
so state it precisely:

- Overture's preset system works. It has both `factory` and `user` origins
  (`src/shared/sound-catalog.ts:4`), a preset-manager overlay
  (`.../overlays/sound-preset-manager.ts`), and a `FileSoundPresetRepository`
  persisting user presets to `<OVERTURE_HOME>/sound_presets`
  (`src/persistence/sound-presets.ts`, `paths.ts:4`).
- **A module's own `presets.json` is what does not reach hardware.** Overture sources
  factory presets from exactly one place — `raw.factoryPresets` on the response to
  `host_get_module_metadata` (`schwung-chain-reader.ts:40-49`). Schwung's
  implementation of that call opens `<base>/<id>/module.json` and nothing else
  (`shadow_ui.c:2118-2130`); no host call exposes `presets.json`. Overture's emulator
  synthesises the field from the module's presets.json, with a comment saying so
  (`overture/web/src/schwung/browser-chain.ts:157-178`), which is why factory presets
  appear in the emulator and not on a Move.

So `presets.json` remains the source of truth for the render suite and the browser,
and the kits ship to hardware by one of the two routes in **Known gaps**.

`SKILL.md` and `plans/ballast-kick-engine.md` used to reach the right conclusion by
the wrong mechanism — they said Overture never reads `presets.json`, when Overture
reads `factoryPresets` fine and it is Schwung that never supplies them. Both are
corrected. The distinction is worth preserving: it is the difference between
"Overture needs a feature" and "one host call needs four more lines".

**Mirror Ballast's preset families.** Ballast ships `Init`, `Deep` ×3, `Dub` ×2,
`Drive` ×2, `Tool` ×2, `Grit` ×2, `Tom` ×2, `Sub` ×2 — family-first names, the only
form that survives being read one row at a time on a 128×64 display. The Ballast plan
already anticipated this engine mirroring them so that the same-named preset across
both gives a coherent kit. Do that: a `Deep Tunnel` kit that sits under Ballast's
`Deep Tunnel`, a `Grit Crush` kit under `Grit Crush`, and so on.

Kits must exercise the parameter space, including automation — Ballast shipped with
zero automation coverage in its goldens until `Tool Clip` was given a `tone` sweep.
At least one kit should sweep `warp`, `kit_decay` or `bright` across its render.

Render patterns must be **polyphonic and realistic** (B2): sixteenth hats with an
offbeat open hat so choke is exercised, a clap on 2 and 4, congas against toms. A
monophonic pattern tests none of what this module is.

---

# Part 11 — First hardware run

Ballast has never run on hardware, and everything the two engines share is validated
offline and in the browser only. That is accepted, not gated — both engines get tested
on device together once this one exists. Keep the shared vocabulary in `_shared` so a
device-found bug is fixed once for both.

Check, in this order:

1. The module appears at all. If it does not, suspect a duplicate parameter key
   (Part 3) or an oversized `module.json` before anything else.
2. All 64 parameters register and respond — a dead knob means the level walk (P1)
   missed a level.
3. The bank UI renders and bank names appear (P7).
4. **Stereo actually arrives.** Nothing in the chain downmixes, but this is the first
   moveforge module to rely on it.
5. **Per-slot µs from Schwung's own reporting** (`schwung_shim.c:4125-4127`), not
   inferred from the dev machine. The Part 7 estimate is a dev-machine extrapolation.
6. Velocity from the pads reaching the module untouched, and the timbre moving with
   it.

---

# Known gaps

- **A module's `presets.json` has no path to hardware** (see Part 10 for exactly
  where it stops). Two fixes, neither in this module's scope:
  - **Merge `presets.json` into `host_get_module_metadata`'s response** in
    `shadow_ui.c` — a handful of lines beside the existing `module.json` read, and
    every moveforge module gains factory presets at once with no Overture change,
    because `schwung-chain-reader.ts` already parses `factoryPresets`. Clearly the
    better fix, but it is an **upstream Schwung change**, so it needs a fork or a PR
    rather than a local edit.
  - **Ship the kits as Overture *user* presets** under `<OVERTURE_HOME>/sound_presets`.
    Needs no upstream change and works today; the cost is that the kits are then
    per-install data rather than part of the module.

  Until one lands, hardware gets the defaults (which is why they have to be a real
  kit) and the emulator gets the full set.
- **Rides are the voice most likely to disappoint**, because a cymbal has hundreds of
  modes and this bank has ten. No longer listed as accepted: Part 9's wash gate makes
  it a build failure rather than a thing someone notices six months later, and Part 4
  names the levers in the order to try them. What *is* accepted is that a 10-partial
  bank will not be a crash cymbal; the target is a usable ride and a convincing
  metallic wash, not orchestral realism.
- **µs-per-block is printed by the harness but not stored in the goldens**, so CPU
  regressions are invisible to CI. Part 9 closes this as part of the work.
- **Serving `ui_hierarchy` from `get_param`** would give true on-device level
  navigation and is the upstream-intended mechanism for synths. Untested in this repo,
  explicitly out of scope, and the level structure this brief specifies is what would
  make it cheap later.

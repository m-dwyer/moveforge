# Ballast — kick / tom / sub-bass engine

Status: design, not yet scaffolded. Nothing here is built.

**Name is provisional.** `ballast` reads well next to Westfold and Dustline and
means "heavy material carried low for stability", which is the job. Alternates:
`plummet` (the pitch envelope literally does), `fathom`, `sounder`. Changing it
later means renaming every file, `index.json`, and the goldens directory — so
settle it before `new-module` runs.

Authoring path: **plain C**. Faust cannot skip work, and this engine wants
trigger-time phase reset, two-stage envelopes and an idle early-out. Closest
existing module to copy structure from is `src/modules/westfold/`.

## Musical concept

One low-end voice, three jobs: kick, tom, sub-bass. They are the same
synthesis — a pitched sine/triangle body with a falling pitch envelope, a
transient on top, and saturation — so they are one engine, not three. A single
`track` parameter moves along that axis: fixed pitch is a kick, note-tracked
with a short decay is a tom, note-tracked with a long decay is an 808 sub.

Building kick and sub as one instrument is the point, not a shortcut. In deep
and driving techno the kick and the sub are one sound; making them literally
one engine means they share a saturation character, a gain reference and a
velocity response for free, instead of being an integration problem.

Two target registers from the same topology, with `tone` and `curve` as the
axis between them: deep and round — long decay, soft saturation, dark tilt,
minimal transient — and mid-forward and driving — shorter decay, hard clip,
tilt up, so the kick cuts through a dense loop rather than sitting under it.

### Why this is worth a live slot

Overture gives four open-engine slots (`TRACK_COUNT = 8`, tracks 4–7 route to
Schwung's four chains). Anything static can be rendered to a WAV and played
from Move's Drum Sampler instead. So a live slot has to earn itself by doing
what a sample cannot:

- respond to velocity as timbre, not just level
- move under Overture Route Motion (per-clip automation lanes, hold or linear)
- vary per hit, so sixteen consecutive kicks are not sixteen identical copies

Those three are therefore first-class requirements, not nice-to-haves. Every
parameter must be smooth and click-free under fast automation, and musically
scaled so a linear automation ramp sounds linear.

## Signal flow

```
note ──┬──► pitch ──► [2-stage pitch env] ──► BODY  sine↔tri, phase-reset ──┐
       │                                                                     │
       ├────────────────────────────► CLICK  impulse + HP noise burst ───────┤
       │                                                                     │
       └────────────────────────────► DIRT   band-passed noise ──────────────┤
                                                                             ▼
                                                                    Σ (one bus)
                                                                             │
                                                        [ tilt EQ, pre-drive ]
                                                                             │
                                                   [ 2× oversampled DRIVE    ]
                                                   [ curve: soft/asym/clip/  ]
                                                   [        fold/crush       ]
                                                                             │
                                                     [ level compensation    ]
                                                                             │
                                          [ DC block → HP 25 Hz → soft limit ]
                                                                             │
                                                                             ▼
                                                            peak ≈ −12 dBFS
```

Drive is applied to the **summed** bus, not per layer. Cheaper, and the
intermodulation between body and click is a large part of why a driven kick
sounds like one object rather than three stacked ones.

### Notes on the parts

**Body.** Phase accumulator, sine↔triangle morph (`body`). Phase is reset on
trigger to `phase`; start phase is a real and underrated punch control — a kick
starting at the waveform peak hits differently from one starting at zero
crossing. Retrigger while still sounding does a ~2 ms crossfade rather than a
hard reset, so legato sub-bass lines do not click while kick-mode retriggers
stay tight.

**Pitch envelope.** Two exponential stages summed:

- fast: 2–40 ms, depth up to ~+40 semitones — this is the attack character
- slow: 20–400 ms, depth up to ~+24 semitones — this is the body drop

`punch` scales the fast stage (and blends in the click), `drop` the slow one,
`sweep` scales both times together. Two stages rather than one because a single
exponential gives you either a click or a boom, not both.

**Click.** Impulse plus a short high-passed noise burst with its own very short
decay. Folded into `punch` rather than exposed separately — one fewer parameter
and the two are always adjusted together in practice.

**Dirt.** Band-passed noise with a medium decay, sitting above the fundamental.
This is the grain that survives distortion. Default 0.

**Tilt.** One-pole shelf pair around ~700 Hz, bipolar on `tone` (0.5 = flat).
Placed **pre-drive**, because what you feed the clipper is most of the
character: tilt up and clip is the mid-forward driving register, tilt down and
soft-saturate is the deep one. A fixed gentle post-compensation keeps
perceived level roughly constant across the sweep.

**Drive.** Five curves behind an `enum` parameter — soft (tanh), asymmetric,
hard clip, wavefolder, crush (bit/rate reduction). Declared as `enum` with
`options` so Schwung's shadow UI shows the label; Overture currently ignores
`options` (`shared/sound-read-model.ts:26-31`) and will show a bare number until
that is fixed, which is no worse than declaring it `int`.

2× oversampled with a short polyphase half-band. A hard-clipped 50 Hz sine puts
its aliasing products around −50 dB, which is marginal on its own but not once
the click and dirt layers are in the same clipper. Cheap enough to be worth it;
measure and drop to 1× if the numbers say otherwise.

**Output.** DC block, first-order HP at 25 Hz (fixed — `tone` and `track` cover
everything useful above it), soft limit, then level. Every module in the chain
must clamp its own output: Schwung does **not** clamp between FX stages
(`chain_host.c:2047-2060`), so an overshoot wraps rather than clips.
`moveforge_float_to_i16` clamps, so this is belt-and-braces, but the soft limit
is what keeps it musical rather than merely safe.

## Parameters

16 params. Page 1 is the sweet-spot set; `knobs` order below is the encoder
order, so the first eight are what you see first.

### Page 1

| key | name | type | min | max | default | notes |
|---|---|---|---|---|---|---|
| `tune` | Tune | float | 24 | 72 | 33 | base pitch in semitones; 33 ≈ 55 Hz |
| `punch` | Punch | float | 0 | 1 | 0.5 | fast pitch-sweep depth + click blend |
| `drop` | Drop | float | 0 | 1 | 0.45 | slow pitch-envelope depth |
| `decay` | Decay | float | 0.05 | 3.0 | 0.45 | amp decay, seconds, exponential taper |
| `drive` | Drive | float | 0 | 1 | 0.3 | saturation amount |
| `tone` | Tone | float | 0 | 1 | 0.5 | pre-drive tilt; 0.5 = flat |
| `dirt` | Dirt | float | 0 | 1 | 0.0 | noise grain layer |
| `level` | Level | float | 0 | 1 | 0.75 | output |

### Page 2

| key | name | type | min | max | default | notes |
|---|---|---|---|---|---|---|
| `track` | Track | float | 0 | 1 | 0 | 0 = fixed pitch (kick), 1 = full note tracking |
| `sweep` | Sweep | float | 0 | 1 | 0.45 | scales both pitch-envelope times |
| `shape` | Shape | float | 0 | 1 | 0.35 | amp decay curve, exponential ↔ linear |
| `phase` | Phase | float | 0 | 1 | 0.0 | oscillator start phase on trigger |
| `curve` | Curve | enum | 0 | 4 | 0 | Soft / Asym / Clip / Fold / Crush |
| `body` | Body | float | 0 | 1 | 0.2 | sine ↔ triangle |
| `vel` | Velocity | float | 0 | 1 | 0.6 | velocity → level, pitch-env depth, drive |
| `human` | Human | float | 0 | 1 | 0.0 | per-hit variation in pitch, decay, drive |

`knobs` order: `tune punch drop decay drive tone dirt level track sweep shape
phase curve body vel human`.

### Scaling and smoothing

- `decay` is exponential in the taper, not linear — a linear decay knob spends
  most of its travel in territory nobody uses.
- `tune` is linear in semitones, exponential in Hz. Correct for a pitch control
  and correct under a linear automation ramp.
- Everything that scales a signal or a frequency goes through `mf_smooth_t`.
  Route Motion delivers stepped values (samples at content ticks, hold or
  linear between them), so unsmoothed params buzz under automation.
- `curve` is the one parameter that steps discontinuously by design. It is not
  a sensible automation target and does not need smoothing; switching mid-note
  is allowed and will be audible.

### What is deliberately absent

- No pitch-bend range parameter. Bend applies at a fixed ±2 semitones. Adding a
  range knob costs a slot on page 2 for something that is set once.
- No separate click level, HP frequency, or per-layer drive. Folded in, fixed,
  or shared respectively.
- No internal LFO. Overture's Route Motion covers continuous movement today and
  host LFOs are coming; duplicating that inside the engine would give the user
  two competing sources of truth for the same parameter. Per-hit variation
  (`human`) is the part a host LFO structurally cannot do, so that stays here.

## Presets

12, following a naming taxonomy the later engines can reuse so that picking the
same-named preset across engines gives a coherent kit.

| name | role |
|---|---|
| Init | neutral starting point, the power-on state |
| Deep Round | long decay, low drive, minimal click — hypnotic |
| Driving Tight | short decay, high punch, mid drive |
| Loop Tool | tilt up + hard clip, mid-forward, sits in a loop |
| Industrial | crush curve, dirt up, aggressive |
| Dub Boom | very long decay, dark tone, no click |
| Click Kick | punch at maximum, very short decay |
| Sub Drop | large drop, long sweep, long decay |
| Tom Low | track up, short decay, drop up |
| Tom High | as above, tuned up |
| 808 Sub | track = 1, long decay, clean |
| Rubber Sub | track = 1, fold curve, driven |

Presets currently reach the browser emulator only. On device, Overture does not
read `presets.json` and never calls Schwung's `preset` / `preset_count` /
`preset_name` protocol, so `factoryPresets` is empty on hardware
(`web/src/schwung/browser-chain.ts:163-164`). Accepted for now; browser-only is
where the work is happening. Closing it later means either teaching Overture to
read `presets.json` or shipping these as Overture Sound Presets under
`/data/UserData/overture/sound_presets`.

## Shared code this adds

Into `src/modules/_shared/`, because the later engines need the same pieces and
sharing them is what makes the family sound like a family:

- **`mf_drive.h`** — the five curves plus a 2× polyphase half-band
  oversampler. This is the grit vocabulary for every engine that follows.
- **`mf_tilt.h`** — bipolar one-pole shelf pair.
- **Two-stage envelope** — extends what `mf_ar_t` does; pitch and amp both need
  it, and so will every percussion voice later.
- **Per-hit variation helper** — seeded from `mf_rng_t`, deterministic per
  instance so offline renders stay reproducible.

## Constraints this must respect

Verified against upstream Schwung `a20cacd1` / v0.11.4.

| constraint | source | consequence here |
|---|---|---|
| ~900 µs per block for all of Schwung, ~225 µs per slot | `schwung/docs/SPI_PROTOCOL.md:127-128` | ~2600 cycles/sample available. Comfortable for this engine; measure rather than assume. |
| No clamp between FX stages — overshoot wraps | `chain_host.c:2047-2060` | Clamp our own output. Soft limit before the int16 conversion. |
| No limiter anywhere in the master path; four slots sum at unity | `schwung_shim.c:2434-2443` | Peak ≈ −12 dBFS at velocity 100 with default `level`. This is the family gain reference. |
| Schwung master FX process the ME bus only, not Move's audio | `schwung_shim.c:2406-2423` | Bus glue cannot be used to unify this engine with the Ableton engines. Cohesion has to come from matched gain staging and saturation character. |
| `set_param` is stringly-typed and runs on the audio thread, re-issued per block while smoothing | `chain_host.c:1975-1986` | Generated setter is fine; do not add per-key work to it. |
| MIDI has no sample offset; render is deferred one block | `plugin_api_v1.h:210`, `schwung_shim.c:1577-1580` | ~2.9 ms trigger quantisation, ~5.8 ms note-on to audio. Not fixable in the module. |
| Idle gate: slot stops rendering after ~1 s below −78 dBFS | `schwung_shim.c:611-614` | Does not help between hits during a groove — the slot stays active. Per-voice early-out is our job, and matters more in the later multi-voice engine than here. |
| FPCR flush-to-zero is set on device only | `schwung_shim.c:4230-4241` | Offline and WASM renders do not get it. Watch for denormal stalls in the harness that will not appear on device. |
| Duplicate param keys zero out a module's entire param list | `chain_params.c:531-541` | Not a risk at one hierarchy level, but the validator should catch it before the multi-voice engine exists. |

## Edge cases and safety

- **Retrigger while sounding** — ~2 ms crossfade rather than a hard phase
  reset. Kick-mode retriggers stay tight; legato sub lines do not click.
- **Extreme drive + level + dirt** — soft limit holds it. Covered by
  `mise run stress`, which renders each param at min/max and all-max.
- **Long decay into the idle gate** — a 3 s tail crossing −78 dBFS is already
  inaudible, and a note-on clears the idle flag, so this is benign.
- **Fast automation** of `tune`, `decay`, `drive`, `tone` — all smoothed.
- **Non-finite output** — sanitize on the way out. The offline harness compiles
  with `-DMOVEFORGE_COUNT_NONFINITE` and fails the render on any NaN, which is
  how two silent dustline presets got blessed twice before.
- **`human` and determinism** — RNG seeded from a fixed constant per instance
  so the render suite is reproducible run to run.

## Verification

1. `mise run test` — core smoke: init, param clamping, finite bounded output.
2. `MODULE_ID=ballast mise run suite` then `plot` — check the fundamental lands
   where `tune` says, no DC offset, decay shape matches `shape`.
3. `MODULE_ID=ballast mise run stress` then `plot-stress` — no clipping, no
   runaway, no unexpected silence at any parameter extreme.
4. Peak level assertion: default preset at velocity 100 peaks within ~1 dB of
   −12 dBFS. This is the cross-engine gain reference and belongs in the goldens.
5. Browser audition via `mise run dev`, including automation of `tune` and
   `drive` to confirm smoothing under stepped Route-Motion-style updates.
6. `mise run check` exits 0.

## Related work this depends on or unblocks

Small, done alongside:

- **`lroundf` in `moveforge_float_to_i16`** (`_shared/dsp_runtime.h:49`). It
  currently truncates, which is signal-correlated error toward zero, worst
  exactly where decaying tails live. Upstream Schwung rounds everywhere it
  converts (`schwung_shim.c:2438`, `:2469`, `:2486`); moveforge is the odd one
  out. Five lines, improves every existing module. Will invalidate goldens.
- **µs-per-block timing in the render harness**, stored in the golden metrics
  next to the audio ones. Makes the scope of engine #2 a measured decision
  rather than an argument. Schwung already publishes per-slot microseconds on
  device (`schwung_shim.c:4125-4127`) for cross-checking.

Deferred, gated on later engines or on device use:

- Nested `ui_hierarchy` levels in `gen-ui-chain.ts` (reads `levels.root` only).
  Needed by the multi-voice percussion engine. Note that engine should use
  **explicit named levels with unique prefixed keys**, not `child_prefix` —
  Overture flattens named levels correctly but has no `child_prefix` support and
  would emit `synth:decay` where the DSP expects `synth:hat_decay`, silently
  wrong on device while looking correct in the emulator.
- `options` on enum params in Overture's reader.
- Schwung `get_param("state")` round-trip. Only matters for raw Schwung chains
  outside Overture — Overture persists its own flat parameter map
  (`persistence/project-document.ts:34-46`) and never reads the engine back.
- Factory preset delivery to device, as above.

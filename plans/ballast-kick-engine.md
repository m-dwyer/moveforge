# Ballast — kick / tom / sub-bass engine

Status: **built**. Scaffolded, implemented, 12 presets rendered, `mise run
check` green. Sections below were revised where the implementation diverged
from the original design; each divergence says why.

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
                                                   [ DRIVE                   ]
                                                   [ curve: soft/asym/clip/  ]
                                                   [        fold/crush       ]
                                                                             │
                                                   [ peak normalisation      ]
                                                                             │
                                                    [ DC block → soft limit  ]
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
crossing.

Retrigger while still sounding would step the output. *Revised:* rather than
the planned crossfade, which needs a second oscillator, the fix is a declick
offset — seed a value with exactly the step the reset produced and decay it
over ~0.7 ms. The output is then continuous by construction, at the cost of one
float and two ops. Inaudible in kick mode, where the new transient masks it,
and the difference between usable and unusable for legato sub lines.
`all_notes_off` reuses the same ramp so panic fades rather than cuts.

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

**Drive.** Five curves — soft (tanh), asymmetric, hard clip, wavefolder, crush
(bit/rate reduction).

*Revised:* declared `"type": "int"`, not `enum`. Every discrete selector already
in this repo is an `int` (`trail`'s `sync`, `lobber`'s `mode`) and no module
uses `enum` yet, so `enum` would have been the first untested path through
gen-params, gen-ui-chain, validate and the web harness. It buys nothing in
Overture either, which ignores `params[].options` entirely
(`shared/sound-read-model.ts:26-31`). The curve names live in `metadata.json`
instead, which is where this repo puts human-readable help.

*Revised:* **no oversampling in v1.** The plan called for 2×. Two reasons to
defer rather than build it: the body is a low sine, so a hard-clipped 55 Hz
fundamental puts its folded energy around −52 dB and falling, and a short
half-band good enough to be cheap only attenuates by about the same amount —
so the first version would have cost real CPU to cancel roughly as much
aliasing as it introduced ripple. Crush wants its aliasing regardless. This is
a measurement to make against a rendered spectrum with the click and dirt
layers hot, not an assumption to build in. Revisit if the top end of a driven
`Industrial` or `Click Kick` patch measures dirty.

**Output.** DC block, soft limit, then level.

*Revised:* no separate 25 Hz highpass. `mf_dcblock_t`'s corner is already
17.5 Hz, and stacking a 25 Hz first-order stage on top of it would cost about
2 dB at 32.7 Hz — the bottom of `tune`, and exactly the fundamental a sub-bass
patch is there to produce. One blocker does the job.

Every module in the chain
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
| `volume` | Volume | float | 0 | 1 | 0.75 | output |

### Page 2

| key | name | type | min | max | default | notes |
|---|---|---|---|---|---|---|
| `track` | Track | float | 0 | 1 | 0 | 0 = fixed pitch (kick), 1 = full note tracking |
| `sweep` | Sweep | float | 0 | 1 | 0.45 | scales both pitch-envelope times |
| `shape` | Shape | float | 0 | 1 | 0.35 | amp decay curve, exponential ↔ linear |
| `phase` | Phase | float | 0 | 1 | 0.0 | oscillator start phase on trigger |
| `curve` | Curve | int | 0 | 4 | 0 | Soft / Asym / Clip / Fold / Crush |
| `body` | Body | float | 0 | 1 | 0.2 | sine ↔ triangle |
| `vel_depth` | Vel Depth | float | 0 | 1 | 0.6 | velocity → level, pitch-env depth, drive |
| `human` | Human | float | 0 | 1 | 0.0 | per-hit variation in pitch, decay, drive |

`knobs` order: `tune punch drop decay drive tone dirt volume track sweep shape
phase curve body vel_depth human`.

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

*Revised:* all of it went into `mf_dsp.h` rather than new `mf_drive.h` /
`mf_tilt.h` headers. Saturation (`mf_tanh_approx`, `mf_soft_limit`) and the
filters already live there, splitting them across three files would scatter one
story, and `tests/test_mf_dsp.c` is then the single home for their coverage.

- **`mf_drive_t` + `mf_drive_coeffs_t`** — the five curves behind one
  interface, each clean at drive 0 and peak-normalised so the knob changes
  character rather than level. This is the grit vocabulary for every engine
  that follows.
- **`mf_fold`** — triangle wavefolder, identity on [-1, 1] and continuous
  everywhere, so it has no usable-range colouration and no wrap artefacts.
- **`mf_tilt_t`** — complementary crossover rather than shelving biquads, so
  0 dB is bit-exactly transparent instead of rippling at the centre detent.

Not extracted: the two-stage envelope. Ballast crossfades a parallel
exponential and linear envelope, which is two adds per sample and specific to
wanting a `shape` morph. Worth promoting to `_shared` when the second engine
needs the same thing and its real shape is known — not before.

## Constraints this must respect

Verified against upstream Schwung `a20cacd1` / v0.11.4.

| constraint | source | consequence here |
|---|---|---|
| ~900 µs per block for all of Schwung, ~225 µs per slot | `schwung/docs/SPI_PROTOCOL.md:127-128` | ~2600 cycles/sample available. Comfortable for this engine; measure rather than assume. |
| No clamp between FX stages — overshoot wraps | `chain_host.c:2047-2060` | Clamp our own output. Soft limit before the int16 conversion. |
| No limiter anywhere in the master path; four slots sum at unity | `schwung_shim.c:2434-2443` | Peak ≈ −12 dBFS at velocity 100 with default `volume`. This is the family gain reference. |
| Schwung master FX process the ME bus only, not Move's audio | `schwung_shim.c:2406-2423` | Bus glue cannot be used to unify this engine with the Ableton engines. Cohesion has to come from matched gain staging and saturation character. |
| `set_param` is stringly-typed and runs on the audio thread, re-issued per block while smoothing | `chain_host.c:1975-1986` | Generated setter is fine; do not add per-key work to it. |
| MIDI has no sample offset; render is deferred one block | `plugin_api_v1.h:210`, `schwung_shim.c:1577-1580` | ~2.9 ms trigger quantisation, ~5.8 ms note-on to audio. Not fixable in the module. |
| Idle gate: slot stops rendering after ~1 s below −78 dBFS | `schwung_shim.c:611-614` | Does not help between hits during a groove — the slot stays active. Per-voice early-out is our job, and matters more in the later multi-voice engine than here. |
| FPCR flush-to-zero is set on device only | `schwung_shim.c:4230-4241` | Offline and WASM renders do not get it. Watch for denormal stalls in the harness that will not appear on device. |
| Duplicate param keys zero out a module's entire param list | `chain_params.c:531-541` | Not a risk at one hierarchy level, but the validator should catch it before the multi-voice engine exists. |

## Edge cases and safety

- **Retrigger while sounding** — a ~0.7 ms declick offset ramp absorbs the
  phase-reset step. Kick-mode retriggers stay tight; legato sub lines do not
  click. Asserted in `tests/test_ballast_core.c` by comparing the largest
  sample-to-sample step across a retrigger against the largest during steady
  decay, with the noise layers off so the phase reset is the only
  discontinuity available.
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

## Measured

From the first green build, on an Apple-silicon dev machine — not the CM4, so
treat these as a lower bound and re-measure on device before drawing
conclusions.

**CPU.** Median **3 µs** per 128-frame block across the twelve preset renders,
p99 4 µs, worst single block 21 µs. The slot share is roughly 225 µs, so even
allowing an order of magnitude for the A72 this sits comfortably inside
budget — which is the evidence that the topology did not need pre-emptive
trimming, and that the deferred oversampling has room if measurement later
asks for it.

**Gain staging.** All twelve presets peak between −12.8 and −11.2 dBFS, inside
±0.9 dB of the −12 dBFS cross-engine reference. Worst DC offset across the
suite is 0.00033.

**Stress.** 30 generated parameter-extreme renders pass the metric gates
(clipping, DC, silence, hotness, stereo balance).


## Second pass — what four reviews changed

Reviews of the first build (correctness, sound design, tests, presets) found
three defects and three sound problems worth acting on. Fixes are in
`01e6732` and the commit following it; the measurements behind each are below.

### Envelope-normalised drive

The drive stage had a static pre-gain, so as the body decayed it fell out of
the clipper — the stage behaved as an infinite-ratio limiter with a
several-hundred-millisecond hold. Measured on hard clip:

| drive | crest before | crest after | flat-top before | after |
|---|---|---|---|---|
| 0.00 | 12.1 dB | 12.1 dB | 26 ms | 26 ms |
| 0.50 | 3.8 dB | 8.9 dB | 276 ms | 74 ms |
| 1.00 | 1.9 dB | 8.9 dB | 426 ms | 80 ms |

At full drive the old code produced a 426 ms flat top — a square wave, not a
drum. Drive is now applied to `x / env` and the envelope reimposed after, where
`env` is the body envelope floored at 0.12. The mid-to-low ratio *improves* at
the same time (−5.79 → −5.23 dB at full drive), so this is not a trade: the
transient comes back and there is more midrange than before.

The floor matters. Without one, a long tail keeps getting boosted into the
clipper and ends as a decaying square. Floored at 0.12 the last 18 dB of decay
falls out of the drive naturally, which is also what an analogue circuit does.

### Pitch envelope retuned

The old ranges left the default patch 187 ms from settling within a semitone,
against a 450 ms decay — audibly rubbery rather than solid — and locked
`t_slow` at exactly 10× `t_fast` at every knob position, so neither a tick over
a long dive nor a slow bloom with a tight body was reachable.

Now 1.5–15 ms and 10–200 ms, which spans 31 ms to 188 ms of settling time and
lets the ratio range about 7:1 to 13:1. The range was right after that; the
*default* was not, so `sweep` drops from 0.45 to 0.22 — about 55 ms, the tight
techno window.

### Click level

Raised from 0.5 to 0.9 after measuring the 2–6 kHz peak in the first 10 ms
relative to the hit's overall peak: the click now contributes 8–9 dB over what
the pitch sweep alone provides, versus about 6 dB before, putting the default
patch near −8 dB band-relative.

**Not done: splitting click level off `punch`.** The sound-design review read
the click as effectively absent (55 dB down) and recommended a separate
parameter. That measurement averaged band energy over a 10 ms window, which
dilutes a ~1 ms transient by 10–20 dB; measured as a band peak the click was
already present, so the case for spending a 17th parameter slot — the largest
count in the repo — is weaker than it looked. Revisit if it sounds thin in
context. The percussion engine will need a first-class noise layer regardless,
and that is the natural point to extract one.

### Not done, deliberately

**Retapering `decay`.** It is linear in seconds, so the 100–400 ms window sits
in the bottom quarter of the travel. Making it exponential would either lose
the seconds display, which is the useful thing about the control, or make
automation non-linear in time, which is worse for a Route Motion lane. With
295 encoder detents over the range, 30 of them land in that window, which is
enough. Left alone.

## Third pass — velocity, presets, tests

### Velocity now moves timbre

The noise layers were not velocity-scaled, so a soft hit kept full click and
dirt while the body was attenuated — measured spectral centroid ran *backwards*,
180 Hz at velocity 0.25 down to 146 Hz at full, and the attack band moved only
1.2 dB across the whole velocity range. That is why velocity read as a level
control despite the plan calling velocity-as-timbre a first-class requirement.

Click and dirt now scale with velocity **squared**, steeper than level, because
the attack transient is what carries perceived hardness. The attack band now
moves 7.5 dB across velocity and the centroid rises with it.

### 16 presets

Adopted the review's lineup, naming and ordering; re-derived every value
against the current engine, since `sweep` semantics and the drive both changed
after it measured them.

Family-first names in role blocks — `Init`, `Deep` x3, `Dub` x2, `Drive` x2,
`Tool` x2, `Grit` x2, `Tom` x2, `Sub` x2 — because that is the only form that
survives being read one row at a time on a 128x64 display, and because a later
percussion engine can mirror the families so the same-named preset across
engines gives a coherent kit.

What it fixed: `Deep Round` / `Dub Boom` / `Sub Drop` were one sound at three
lengths, so `Sub Drop` became `Dub Dive` with real character; `Tom Low` was at
53 Hz, below the kick presets, so it moves to `tune` 47; the missing long-and-
driven rumble, a short-and-dark, a fold preset and a gated one fill the empty
regions; `dirt`, `human` and `shape > 0.7` were barely exercised and now are.

Measured: peak spread **1.77 dB**, perceived-loudness spread **5.3 dB** (was
10.0 in the original twelve), 32 stress renders passing.

### `tail_seconds`

The suite could not capture a tail longer than one note interval, because
`render_wav.c` fired note-ons forever — so a 2 s decay rendered with its tail
chopped at -10 dB no matter what `seconds` said, and the plan's own
verification step "check the decay shape matches `shape`" was not actually
performable. `tail_seconds` stops triggering that far before the end. Every
preset now ends below -77 dBFS, most in true silence.

### Tests

Closed the gaps a mutation-testing review found, each verified by reverting the
fix and watching the assertion go red:

- **`test_drive` passed with three of five curves replaced by `return x`.**
  Soft, clip and fold had no character assertion at all, and swapping fold for
  hard clip was undetectable. Now every curve must deviate from its input under
  drive, and each carries a monotonicity fingerprint — fold is the only
  non-monotone curve, which is exactly what makes it a folder.
- **`peak > 0.6` asserted nothing** — every curve measures exactly 1.000.
  Tightened to [0.9, 1.05].
- **The -12 dBFS reference had no absolute assertion**, only "unchanged"
  goldens that a bless can walk away. Now pinned in C.
- **Velocity, `human` and per-block automation had no coverage.** All three
  now asserted; the automation one measures a boundary step of 90x the signal's
  own slew when the tilt ramp is removed.
- **Every stress render used velocity 127**, which makes any velocity-depth
  parameter a no-op, so the whole velocity path went unexercised. Added soft-hit
  cases to the generated suite for all sound generators.
- **No preset used `automate`**, so the goldens had zero automation coverage.
  `Tool Clip` now sweeps `tone` across its render.

One implementation change came out of writing those tests: tilt and dirt were
ramping to their target within a single block, which is click-free but still
moves a 12 dB swing nearly 4x faster than the signal's own slew. They now glide
over about 15 ms.

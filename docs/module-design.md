# Designing a module

What a good moveforge module should sound like and how it must behave under
real-time constraints. `AGENTS.md` covers the repo mechanics and
`skills/schwung-dsp-development/SKILL.md` the authoring workflow; this is the
taste and safety half.

The target is high-quality electronic music tools, especially hypnotic techno,
dub techno, industrial techno, minimal techno, and experimental groove-based
music.

## Priorities

Prioritise musical usefulness over novelty. A good module should help produce
evolving grooves, tension, movement, texture, modulation, controlled chaos, or
performance-friendly variation.

Optimise for:

* stable real-time audio
* low CPU and allocation-free processing
* predictable gain staging
* click-free parameter changes
* playable parameter ranges
* useful defaults
* techno-oriented sound design
* simple controls with deep sweet spots
* compatibility with Ableton Move/Schwung constraints

Avoid over-engineered modules with too many parameters unless the repo already
supports that style well.

## Real-time audio rules

Do not allocate memory in the audio callback.

Avoid locks, file IO, logging, exceptions, heap allocation, dynamic resizing,
expensive math in hot paths, and unbounded loops inside real-time processing.

Prefer precomputed coefficients, smoothing, lookup tables where appropriate,
denormal protection, bounded feedback, and explicit saturation/limiting where
feedback or resonance is involved.

Every module must handle silence, extreme parameter values, high
resonance/feedback, fast automation, and unusual sample rates without exploding,
NaNs, infinities, or runaway gain.

`src/modules/_shared/mf_dsp.h` already provides the pieces this usually needs —
`mf_svf_t`, `mf_dcblock_t`, `mf_onepole_t`, `mf_smooth_t`, `mf_ar_t`,
`mf_tanh_approx`, `mf_soft_limit`, `mf_rng_t`, `mf_voice_t`, denormal flush and
NaN sanitize. Reach for those before writing another one; the shared versions
are the tested ones (`tests/test_mf_dsp.c`).

`set_param` is called from the SPI (real-time) thread on device, not from a UI
thread. Treat it accordingly.

## Musical design bias

When designing synth engines, prefer sounds useful for techno:

* sub-safe kicks and basses
* FM percussion
* metallic hats and rides
* resonant stabs
* dub chords
* drones
* noise textures
* phasey/rubbery basslines
* syncopated modulation
* evolving timbres
* controlled instability

When designing FX, prefer performance-friendly movement:

* dub delays
* filters
* frequency shifters
* resonators
* distortions
* transient shapers
* compressors/duckers
* reverbs/ambiences
* glitch, freeze, repeat, stutter, and buffer effects
* modulation effects with tempo-aware behaviour where possible

When designing MIDI FX, prefer groove generation:

* probability
* ratchets
* Euclidean rhythms
* note folding
* octave displacement
* accent generation
* velocity shaping
* scale constraints
* controlled randomisation
* evolving pattern mutation

## Implementation approach

Before coding, identify the closest existing module and follow its structure.

For each new module, provide:

1. a short musical concept
2. intended use cases
3. parameter list with ranges/defaults
4. implementation notes
5. edge cases and safety considerations
6. tests or manual verification steps

Prefer small, complete modules over large incomplete systems.

Use clear DSP names and comments for non-obvious algorithms. Do not add vague
"magic" constants without explaining their musical or stability purpose.

## Parameter design

Parameters should be musically scaled, not merely linear. Use
logarithmic/exponential scaling for frequency, decay, time, drive, feedback and
modulation depth where appropriate.

Smooth parameters that affect gain, frequency, delay time, feedback, resonance,
wavetable position, or discontinuous state.

Clamp all external parameter input. (`<id>_set_param` clamps from `module.json`'s
min/max for you, since it is generated from the schema.)

Defaults should produce an immediately useful sound. They are also the power-on
state: a fresh instance comes up on `module.json`'s declared defaults, and the
host seeds its knob positions from the same numbers.

## Before finalising

* builds cleanly, and `mise run check` exits 0
* no allocations in the audio path
* no clipping or runaway feedback — `check-stress` holds the absolute bounds
* no NaN/Inf risk; the render harnesses fail on non-finite output
* sensible default patch, clear parameter labels
* useful for techno without requiring extensive setup

Prefer a deterministic offline render over subjective code review when judging a
sound change. When unsure, make a reasonable choice and document the tradeoff
rather than blocking.

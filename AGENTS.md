# Codex guidance: Schwung synth, FX, and MIDI FX modules

You are helping build Schwung modules for Ableton Move, focused on high-quality electronic music tools, especially hypnotic techno, dub techno, industrial techno, minimal techno, and experimental groove-based music.

Assume the repo already contains Schwung-specific conventions and skill docs. Before implementing anything, inspect the existing module patterns, build system, naming conventions, parameter APIs, audio/MIDI callback structure, UI/control mapping, and any examples already present.

## Priorities

Prioritise musical usefulness over novelty. A good module should help produce evolving grooves, tension, movement, texture, modulation, controlled chaos, or performance-friendly variation.

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

Avoid over-engineered modules with too many parameters unless the repo already supports that style well.

## Real-time audio rules

Do not allocate memory in the audio callback.

Avoid locks, file IO, logging, exceptions, heap allocation, dynamic resizing, expensive math in hot paths, and unbounded loops inside real-time processing.

Prefer precomputed coefficients, smoothing, lookup tables where appropriate, denormal protection, bounded feedback, and explicit saturation/limiting where feedback or resonance is involved.

Every module must handle silence, extreme parameter values, high resonance/feedback, fast automation, and unusual sample rates without exploding, NaNs, infinities, or runaway gain.

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

Before coding, identify the closest existing Schwung module and follow its structure.

For each new module, provide:

1. a short musical concept
2. intended use cases
3. parameter list with ranges/defaults
4. implementation notes
5. edge cases and safety considerations
6. tests or manual verification steps if the repo supports them

Prefer small, complete modules over large incomplete systems.

Use clear DSP names and comments for non-obvious algorithms. Do not add vague “magic” constants without explaining their musical or stability purpose.

## Parameter design

Parameters should be musically scaled, not merely linear.

Use logarithmic/exponential scaling for frequency, decay, time, drive, feedback, and modulation depth where appropriate.

Smooth parameters that affect gain, frequency, delay time, feedback, resonance, wavetable position, or discontinuous state.

Clamp all external parameter input.

Defaults should produce an immediately useful sound.

## Safety and quality checks

Before finalising, check:

* builds cleanly
* follows repo formatting/style
* no allocations in audio path
* no obvious clipping/runaway feedback
* no NaN/inf risk
* sensible default patch
* parameter labels are clear
* behaviour is useful for techno without requiring extensive setup

When unsure, ask for clarification only if blocked. Otherwise make a reasonable implementation choice and document the tradeoff.

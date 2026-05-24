# Module Ideas And Gaps

Based on the Schwung catalog snapshot in `upstream/schwung/module-catalog.json`, the ecosystem already has strong coverage for classic subtractive, FM, wavetable/hybrid, ROM/sample playback, granular, tape, reverb, utility, and several performance effects.

Useful gaps to explore:

1. Benjolin / rungler chaos voice
   - Why: there are generative and oscillator-swarm modules, but not a focused Rob Hordijk-style chaotic instrument.
   - Scope: two oscillators, XOR/rungler register, chaotic filter, scale/clock options, instability controls.
   - Risk: needs careful parameter bounding so it is musical rather than just noisy.

2. Focused West Coast voice
   - Why: the catalog has `denis`, a Serge-inspired West Coast synth, but there is room for a simpler "one excellent voice" module.
   - Scope: complex oscillator, wavefolder, LPG, strike/decay behavior, touch/velocity mapped to timbre.
   - This repo starts here with `westfold`.

3. Physical-model plucks and resonators
   - Why: current catalog has broad synth engines and Wurlitzer, but a compact Karplus/modal voice would fit Move's sketchpad style.
   - Scope: plucked strings, mallets, sympathetic resonator, scale-aware damping.

4. Percussion macro synth
   - Why: there are drum/sample modules, but a tweakable synthetic percussion voice bank would be useful.
   - Scope: kick/snare/hat/tom/clap models with macro controls and velocity-sensitive variation.

5. CV-inspired modulation tools
   - Why: Schwung now exposes slot LFO/modulation concepts, but dedicated random/S&H/chaos MIDI FX could make stock Move instruments more alive.
   - Scope: tempo-synced random walks, Turing-machine style note source, probability gates, accent streams.

6. Character FX that are not another reverb/tape
   - Ideas: wavefolder FX, LPG/auto-vactrol, resonator bank, comb ensemble, frequency shifter, FSU delay with pitch quantization.

Recommended order:

1. Finish `westfold` enough to validate the full local-render and Move-package loop.
2. Extract reusable oscillator/envelope/filter helpers.
3. Build Benjolin as the second module once the harness is trusted.
4. Add a small audio FX template after the sound-generator path is stable.


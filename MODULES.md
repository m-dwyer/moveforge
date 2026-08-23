# Moveforge Module Index

This index lists the checked-in Schwung modules by component type. Each module is self-contained under `src/modules/<id>/` with metadata, presets, UI shims, and DSP source.

## Sound Generators

| id | name | authoring | description |
|---|---|---|---|
| `ballast` | Ballast | plain C | Kick, tom and sub-bass from one low-end voice: sine↔triangle body under a two-stage pitch envelope, click and noise-grain layers, pre-drive tilt into five saturation curves (soft/asym/clip/fold/crush). `track` morphs fixed-pitch kick → note-tracked tom → 808 sub. One-shot; drive is envelope-normalised so saturation keeps the transient. 16 params, 16 presets. User manual: [`src/modules/ballast/MANUAL.md`](src/modules/ballast/MANUAL.md). Design notes: [`plans/ballast-kick-engine.md`](plans/ballast-kick-engine.md). |
| `swarf` | Swarf | plain C | Six note-mapped percussion voices — hat, open hat, ride, clap, conga, wood — sharing one engine, each with its own tune/decay/material/body/tone/strike/grit/level bank. The only multi-group module: eight `ui_hierarchy` levels (six voices plus `kit` and `map`), so it is the one that exercises group ordering as an ABI. 62 params, 16 presets. |
| `westfold` | Westfold | plain C | West Coast synth voice with dual-oscillator phase modulation, snap-assisted ratio, wavefolder, low-pass gate, tone/width controls, drive/strike/chaos macros, and techno-oriented pluck/bass/lead presets. |
| `dustline` | Dustline | plain C | Compact subtractive voice with oscillator blend, noise, resonant filter, drive, and simple performance controls. |
| `faust_voice` | Faust Voice | Faust | Reference Faust monophonic saw voice with ADSR-style envelope, resonant low-pass filter, and saturation. |

## Audio FX

| id | name | authoring | description |
|---|---|---|---|
| `trail` | Trail Delay | Faust | Lush stereo delay for hypnotic techno: free or tempo-synced time (1/16–1/1, incl. dotted/triplet), LFO modulation, filtered + saturated feedback, stereo→ping-pong width, and an integrated reverb tail. Params: time, sync, feedback, tone, mod, width, drive, space, mix. |
| `filter` | Multimode Filter | Faust | Stereo state-variable filter morphing continuously between its own lowpass, bandpass and highpass taps, so all three shapes share one recursion and the morph costs no more than a fixed mode. Cutoff, resonance and morph are normalised 0–1; the musical mappings (20 Hz–18 kHz exponential, Q 0.5–20) live in the DSP. Resonance peaks are bounded by saturation rather than a broadband trim, so the body holds while the peak sings. Params: cutoff, resonance, morph. 3 params, 5 presets. |
| `faust_drive` | Faust Drive | Faust | Reference Faust stereo drive/tone/mix saturator. |
| `vca` | VCA | C | Note-gated ADSR amplifier for a chain whose Source shapes no loudness of its own. Declares `midi_in`, so the notes that play the Source open and close it too; the last note-off starts the release, and a panic closes it through `all_notes_off`. Until the first note it passes audio untouched, so adding one is inaudible rather than a cut. Attack arrives in the time it states; decay and release are one-poles in `sec`, sustain a level in %. Params: attack, decay, sustain, release. 4 params, 4 presets. |
| `lobber` | Lobber | C | Tempo-locked slice buffer with three play modes — Live (lob/stutter/reverse/throw the live buffer), Loop (capture a bar and play it tempo-followed), Slice (fire slices of the captured loop over the live input). Played via pads (lob grid on ch0, function row on ch1) or knobs. Syncs to host tempo, falls back to a bpm param; Loop mutes on transport stop. Params: active, offset, division, mode, loop, ratchet, reverse, freeze, mute, capture, loop_beats, mix, bpm, xfade. User manual: [`src/modules/lobber/MANUAL.md`](src/modules/lobber/MANUAL.md). Parity roadmap: [`src/modules/lobber/PARITY.md`](src/modules/lobber/PARITY.md). |

## MIDI FX

| id | name | authoring | description |
|---|---|---|---|
| `arpy` | Arpy | plain C | Arpeggiator MIDI effect with pattern, chord, and rate controls. |

## Coverage Notes

- Sound generators and audio FX support offline WAV rendering, preset plots, and metadata-generated stress tests.
- MIDI FX modules render deterministic trace files rather than WAV audio, so audio stress plots do not apply to them yet.
- `mise run stress` currently exercises every sound generator and audio FX listed in `src/modules/index.json` (`mise run stress-all` is an alias for it, kept for habit).

# Moveforge Module Index

This index lists the checked-in Schwung modules by component type. Each module is self-contained under `src/modules/<id>/` with metadata, presets, UI shims, and DSP source.

## Sound Generators

| id | name | authoring | description |
|---|---|---|---|
| `westfold` | Westfold | plain C | West Coast synth voice with dual-oscillator phase modulation, snap-assisted ratio, wavefolder, low-pass gate, tone/width controls, drive/strike/chaos macros, and techno-oriented pluck/bass/lead presets. |
| `dustline` | Dustline | plain C | Compact subtractive voice with oscillator blend, noise, resonant filter, drive, and simple performance controls. |
| `faust_voice` | Faust Voice | Faust | Reference Faust monophonic saw voice with ADSR-style envelope, resonant low-pass filter, and saturation. |

## Audio FX

| id | name | authoring | description |
|---|---|---|---|
| `trail` | Trail Delay | Faust | Lush stereo delay for hypnotic techno: free or tempo-synced time (1/16–1/1, incl. dotted/triplet), LFO modulation, filtered + saturated feedback, stereo→ping-pong width, and an integrated reverb tail. Params: time, sync, feedback, tone, mod, width, drive, space, mix. |
| `faust_drive` | Faust Drive | Faust | Reference Faust stereo drive/tone/mix saturator. |

## MIDI FX

| id | name | authoring | description |
|---|---|---|---|
| `arpy` | Arpy | plain C | Arpeggiator MIDI effect with pattern, chord, and rate controls. |

## Coverage Notes

- Sound generators and audio FX support offline WAV rendering, preset plots, and metadata-generated stress tests.
- MIDI FX modules render deterministic trace files rather than WAV audio, so audio stress plots do not apply to them yet.
- `mise run stress-all` currently exercises every sound generator and audio FX listed in `src/modules/index.json`.

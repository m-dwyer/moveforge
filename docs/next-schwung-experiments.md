# Next Schwung Experiments

This note captures two follow-up tracks:

1. how far Moveforge should go toward upstream Shadow UI fidelity
2. the first high-value module to build: a modulation/router module

## Shadow UI Integration Options

Moveforge's web UI is currently a browser-native emulator, not Schwung's real
Shadow UI. It mimics selected Shadow concepts, but does not execute
`upstream/schwung/src/shadow/shadow_ui.js` or the QuickJS/device host APIs.

### Option 1: Full Shadow UI Emulation

Run upstream `shadow_ui.js` directly in the browser by building shims for the
host APIs it expects.

What this needs:

- display drawing shims
- MIDI input/output shims
- `shadow_get_param` / `shadow_set_param` state model
- module scanning and patch config shims
- filesystem/config shims
- logging/store/overtake stubs

Pros:

- highest fidelity to Schwung
- catches Shadow UI behavior drift quickly

Cons:

- high implementation cost
- fragile because Shadow UI expects the on-device QuickJS runtime
- likely to accumulate many compatibility stubs

Recommendation: defer unless hardware testing proves the emulator is diverging
in ways that are hard to model manually.

### Option 2: Extract Shared View/Formatting Logic

Reuse targeted upstream modules where they are browser-compatible, such as:

- `chain_ui_views.mjs`
- `chain_param_utils.mjs`
- `param_format.mjs`
- knob acceleration helpers

Pros:

- improves fidelity without swallowing the whole Shadow runtime
- lower risk than full Shadow UI emulation
- keeps Moveforge browser-native

Cons:

- still requires adapter data structures
- not every Shadow module is cleanly reusable outside device runtime

Recommendation: good medium-term path.

### Option 3: Keep Browser-Native UI, Audit Against Upstream

Continue maintaining Moveforge's own web UI, but treat upstream Schwung as the
spec for:

- fixed chain component keys
- slot settings and ranges
- LFO shapes/rates/target picking
- `chain_params` formatting
- module and parameter picker behavior
- capture rules
- patch JSON shape

Pros:

- fastest
- easiest to keep pleasant in a desktop browser
- avoids pretending the browser is the Move runtime

Cons:

- requires regular audits against upstream
- may miss subtle hardware/Shadow UI behavior

Recommendation: best near-term approach.

## First Module To Build: ModRouter

The most promising first original module is a modulation/router module.

Instead of making sound, it generates control signals and routes them to
parameters on the currently loaded Signal Chain components.

Concept:

```text
source motion -> target module -> target parameter
```

Example:

```text
Lane 1: Sine LFO -> Synth Fold
Lane 2: Random S&H -> FX1 Wet
```

Schwung already exposes runtime modulation callbacks for this:

```c
mod_emit_value(source_id, target, param, signal, depth, offset, bipolar, enabled);
mod_clear_source(source_id);
```

Valid targets are fixed chain component IDs such as:

```text
synth
fx1
fx2
midi_fx1
midi_fx2
```

### MVP Scope

Build `modrouter` as a chainable module with two lanes.

Each lane:

- enable
- target module
- target parameter
- shape: sine or sample-and-hold
- rate
- depth
- offset
- bipolar/unipolar

Device UI should use existing `chain_params` picker types:

- `module_picker`
- `parameter_picker`
- enums for shape/rate
- numeric controls for depth/offset

Keep the first version small: two lanes, no macros, no scenes, no capture.

### Why This Is Useful

It makes any well-behaved chainable synth/FX module more expressive:

```text
Westfold Fold moves automatically
Dustline Cutoff jitters rhythmically
Drive Tone Wet pulses on a slow LFO
```

It also gives Moveforge a strong reason to model real modulation behavior in
the web emulator.

### Later Growth

#### Macros

One control changes multiple parameters at once:

```text
Macro 1 "Brighten"
- Synth Fold up
- Synth LPG open
- FX1 Wet down
- FX2 Tone up
```

Useful because Move only has eight encoders.

#### Scenes

Saved sets of modulation/macro states:

```text
Scene 1: Soft pluck
Scene 2: Bright pluck
Scene 3: Dirty lead
Scene 4: Reverb wash
```

Scenes could switch instantly or morph smoothly.

#### Performance Capture

Use Schwung capture rules to route Move controls to the module:

```text
Pads 1-8      -> trigger scenes
Steps 1-16    -> toggle modulation lanes
Jog wheel     -> scrub macro amount
Track buttons -> select scene bank
```

This turns the module into a performance layer instead of only a background LFO.

### Browser Editor / xyflow

xyflow is not useful for Schwung's fixed chain list, but it could be useful for
a browser-side ModRouter editor.

Good xyflow use case:

```text
[LFO 1]    -> [Synth: Fold]
[Random 1] -> [FX1: Wet]
[Macro 1]  -> [Synth: LPG]
           -> [FX2: Tone]
```

Keep device UI list-based. Use a browser graph only for deeper patch editing,
debugging, and export/import.

### Open Questions

- Should ModRouter be a MIDI FX, audio FX, sound generator, or a dedicated
  chain utility module?
- Which component slot should host it in the current fixed chain?
- Does upstream chain host expose modulation callbacks to the module category
  we choose?
- How should tempo sync work before Move hardware is available?
- How should modulation be represented in Moveforge's local AudioWorklet path?


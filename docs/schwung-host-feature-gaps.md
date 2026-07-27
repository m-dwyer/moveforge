# Schwung Host Feature Gaps

Moveforge's browser UI now keeps local slot setting keys aligned with the Schwung host vocabulary, but several host-level features are still only modeled as browser state. This doc is the implementation target for making those controls real.

## Current Alignment

The local settings slot uses the same key names as Schwung where the concepts overlap:

- `slot:volume`
- `slot:muted`
- `slot:soloed`
- `slot:receive_channel`
- `slot:forward_channel`
- `midi_fx_pre_mode`
- `lfo1:enabled`
- `lfo1:depth`
- `lfo2:enabled`
- `lfo2:depth`

The browser-only `masterVolume` is intentionally separate. It controls local Web Audio output gain, not Schwung's master FX or Move's master volume.

## Missing Host Behavior

### Slot Settings

Schwung supports per-slot settings that are applied by the chain host. Moveforge currently stores and displays these values, but browser audition does not route or apply them.

Needed work:

- Apply `slot:volume` in the browser audio graph without confusing it with module output gain.
- Implement local `slot:muted` and `slot:soloed` behavior or hide those controls until they are active.
- Decide whether `slot:receive_channel` and `slot:forward_channel` should affect browser MIDI routing, browser export only, or device-only patch metadata.
- Preserve Schwung's `slot:forward_channel` values: `-2` is THRU, `-1` is Auto, `0..15` are channels 1..16.

### MIDI FX Pre Mode

Schwung's `midi_fx_pre_mode` controls whether MIDI FX output is injected back toward Move MIDI input. Browser audition only has local MIDI FX to sound-generator routing.

Needed work:

- Model browser MIDI routing modes explicitly before wiring this control.
- Keep the Schwung key name if it becomes patch/export data.
- Avoid reviving the older `midi_fx_output` browser key.

### LFO Modulation

Schwung has two chain-host LFOs with a fuller parameter surface:

- `lfoN:enabled`
- `lfoN:shape`
- `lfoN:polarity`
- `lfoN:sync`
- `lfoN:rate_hz`
- `lfoN:rate_div`
- `lfoN:depth`
- `lfoN:target`
- `lfoN:target_param`

Moveforge currently keeps only `enabled` and `depth`, and no browser modulation engine applies those values.

Needed work:

- Add the full LFO parameter set only when target selection and modulation application are implemented.
- Reuse Schwung target names: `synth`, `fx1`, `fx2`, `midi_fx1`, etc.
- Keep modulation outside the module DSP wrappers; this is chain-host behavior.
- Ensure browser modulation sends effective parameter values without corrupting base values or parameter snapshots.

### Master FX

Schwung's Master FX chain uses component keys:

- `master_fx:fx1`
- `master_fx:fx2`
- `master_fx:fx3`
- `master_fx:fx4`

Moveforge has a `master` state shape, but no UI or browser audio routing for a real master FX chain.

Needed work:

- Add an explicit Master FX view rather than mixing master FX into per-track chain controls.
- Route mixed track output through the four master FX slots in browser audition.
- Keep local output `masterVolume` after the Master FX chain.
- Add preset/snapshot handling separately from per-track slot presets.

## References

Reference upstream Schwung before implementing:

Paths are relative to the upstream checkout at `upstream/schwung`
(override with `$UPSTREAM_DIR`; see `scripts/update-upstream-schwung.sh`).

- `schwung-manager/static/remote-ui.js`
- `src/modules/chain/dsp/chain_host.c`
- `CLAUDE.md`

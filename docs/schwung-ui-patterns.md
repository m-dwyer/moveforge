# Schwung UI Patterns

Most Moveforge modules should use the shared Schwung UI helpers through
`src/modules/<module-id>/ui.js`. Reach for custom UI only when a module needs a
view that cannot be expressed with `module.json` hierarchy and parameter
metadata.

## Display

- Treat the hardware display as a 128x64 monochrome target.
- Measure or clamp text before drawing; long labels should scroll or truncate
  predictably.
- Keep line spacing tight and consistent. Eight-pixel rows are a useful default
  when building list-style screens.
- Invert the selected row or field rather than relying only on tiny markers.
- Redraw only when state changes. Keep a dirty flag for parameter, selection,
  transport, and MIDI-state changes.

## Controls

- Keep the eight device encoders mapped to visible parameters or visible page
  controls.
- Prefer page navigation over hidden controls once a module has more than eight
  meaningful parameters.
- Ensure external MIDI, internal MIDI, and all-notes-off behavior still pass
  through when custom UI code handles messages.

## LEDs

- Initialize LEDs conservatively and avoid assuming stock Move state is still
  present after entering Shadow UI.
- Treat LED updates as state reflection. Avoid using fast LED animation as a
  timing source or debug channel.

## Debug Loop

1. Run the module locally in the browser emulator.
2. Deploy with `mise run deploy`.
3. Enable and tail logs with `./scripts/tail-move-log.sh --enable`.
4. Capture the device screen with `mise run move-screen`.
5. If UI state looks stale, run `./scripts/clear-move-cache.sh --apply` and `mise run move-restart`.
6. Update emulator assumptions in
   `docs/move-emulator-toolchain.md` when the real device disagrees.

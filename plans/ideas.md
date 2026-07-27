# Ideas

Loose improvements with no owner and no branch. Anything actively being worked
on belongs in its own plan document instead.

- **Browser capture/export.** Record a short WAV from the current WASM state and
  write it beside the offline suite, so the browser and the render harness can
  be A/B'd directly instead of by ear.

- **Hardware screenshot / OLED calibration.** Check the generated UI against the
  real 128x64 display rather than against an assumption about it. `mise run
  move-screen` captures the endpoint; nothing compares the result to anything.

- **MIDI learn, or configurable CC mapping, in the web UI.** CC 20-27 are
  currently hard-coded.

Moved here from `CLAUDE.md`'s "Suggested Improvements" list, minus three that
had already landed (CI gate, clang-format, the `check-renders` work) and one
that is tracked as plan item 7.2 (generating more of the Faust adapter from
`module.json`).

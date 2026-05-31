// Placeholder chain-mode UI shim.
// `pnpm run new-module` and `mise run gen-ui-chain` replace this with the
// generated preset browser + knob-bank parameter editor.
globalThis.chain_ui = {
  init() {},
  tick() {},
  onMidiMessageInternal(_data) {},
  onMidiMessageExternal(_data) {}
};

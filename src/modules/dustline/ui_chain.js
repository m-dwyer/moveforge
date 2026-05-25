// Chain-mode UI shim. Loaded by the Signal Chain host instead of ui.js
// when Dustline is placed in a chain slot. Do not override globalThis.init
// or globalThis.tick — those belong to the chain host.
globalThis.chain_ui = {
  init() {},
  tick() {},
  onMidiMessageInternal(_data) {},
  onMidiMessageExternal(_data) {}
};

// On-device solo UI. Replace with module-specific UI behavior.
// When this module is loaded inside a Signal Chain slot, ui_chain.js is
// loaded instead.
globalThis.init = function () {};
globalThis.tick = function () {};
globalThis.onMidiMessageInternal = function (_data) {};
globalThis.onMidiMessageExternal = function (_data) {};

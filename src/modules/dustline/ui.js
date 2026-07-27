import { createSoundGeneratorUI } from '/data/UserData/schwung/shared/sound_generator_ui.mjs';

// Solo-mode screen. The host calls globalThis.init / tick / onMidiMessage*; it
// never imports a `render` export, so a module that only exports functions is
// never called at all and its solo screen stays blank.
const ui = createSoundGeneratorUI({
  moduleName: 'Dustline',
  showPolyphony: false,
  showOctave: true
});

globalThis.init = ui.init;
globalThis.tick = ui.tick;
globalThis.onMidiMessageInternal = ui.onMidiMessageInternal;
globalThis.onMidiMessageExternal = ui.onMidiMessageExternal;

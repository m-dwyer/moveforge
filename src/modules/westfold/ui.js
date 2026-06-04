import { createSoundGeneratorUI } from '/data/UserData/schwung/shared/sound_generator_ui.mjs';

const ui = createSoundGeneratorUI({
  moduleName: 'Westfold',
  showPolyphony: false,
  showOctave: true
});

const baseTick = ui.tick;

// Scope overlay: a lower strip of the 128x64 display showing the snapshot of
// the most recent note's attack (one frame per note-on, held until the next).
// The DSP serializes "__scope" as 2 chars per column (max-row then min-row,
// each 0..63 offset by 48); see src/modules/_shared/scope.h.
const SCOPE_W = 128;          // one column per pixel-x
const SCOPE_Y0 = 38;          // top of the band
const SCOPE_Y1 = 62;          // bottom of the band
const SCOPE_ENC_BASE = 48;
const SCOPE_ROWS = 64;        // encoded value range from scope.h

function drawScope() {
  const s = host_module_get_param('__scope');
  if (!s || s.length < SCOPE_W * 2) return;  // no frame captured yet
  const bandH = SCOPE_Y1 - SCOPE_Y0;
  fill_rect(0, SCOPE_Y0, SCOPE_W, bandH + 1, 0);  // clear the band
  for (let c = 0; c < SCOPE_W; c++) {
    const top = s.charCodeAt(c * 2) - SCOPE_ENC_BASE;
    const bot = s.charCodeAt(c * 2 + 1) - SCOPE_ENC_BASE;
    if (top < 0 || bot < 0) continue;
    const yTop = SCOPE_Y0 + Math.round((top / (SCOPE_ROWS - 1)) * bandH);
    const yBot = SCOPE_Y0 + Math.round((bot / (SCOPE_ROWS - 1)) * bandH);
    draw_line(c, yTop, c, yBot, 1);
  }
}

globalThis.init = ui.init;
globalThis.tick = function() {
  baseTick();
  drawScope();
};
globalThis.onMidiMessageInternal = ui.onMidiMessageInternal;
globalThis.onMidiMessageExternal = ui.onMidiMessageExternal;

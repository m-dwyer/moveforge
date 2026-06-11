// Solo-mode on-device UI for Lobber.
//
// Lobber is a *played* audio FX: the pad grid throws the read head around the
// tempo-locked buffer. This UI captures pad presses, blocks them from reaching
// Move (so a toss doesn't also trigger a Move track), and injects them into the
// DSP as note on/off — where on_midi maps note -> slice offset. The first two
// pad rows (16 pads) are the toss grid; leftmost pad = "now" (offset 0).

import { MovePads, Cyan, Red } from '../../shared/constants.mjs';
import { setLED, clearAllLEDs } from '../../shared/input_filter.mjs';

const TOSS_PADS = 16;        // pads that act as toss positions (offsets 0..15)
const IDLE_COLOR = Cyan;     // dim grid showing the toss row
const ACTIVE_COLOR = Red;    // pad currently holding a toss

let activePad = -1;          // pad index currently held (-1 = none)
let needRedraw = true;

// Pure mapping: a Move pad note -> slice offset, or -1 if it isn't a toss pad.
// The pad index is the offset, so the DSP (note % 16) lands on the same slice.
export function padToOffset(note) {
  const idx = MovePads.indexOf(note);
  if (idx < 0 || idx >= TOSS_PADS) return -1;
  return idx;
}

function lightGrid() {
  for (let i = 0; i < TOSS_PADS; i++) {
    setLED(MovePads[i], i === activePad ? ACTIVE_COLOR : IDLE_COLOR);
  }
}

globalThis.init = function init() {
  // Pads drive the effect, not Move's tracks.
  if (typeof host_pad_block === 'function') host_pad_block(true);
  clearAllLEDs();
  activePad = -1;
  lightGrid();
  needRedraw = true;
};

globalThis.tick = function tick() {
  if (!needRedraw) return;
  needRedraw = false;
  clear_screen();
  print(2, 2, 'Lobber', 1);
  print(2, 18, activePad >= 0 ? ('Toss slice ' + activePad) : 'Hold a pad to toss', 1);
};

globalThis.onMidiMessageInternal = function onMidiMessageInternal(data) {
  if (!data || data.length < 3) return;
  const status = data[0] & 0xF0;
  const note = data[1];
  const vel = data[2];
  const offset = padToOffset(note);
  if (offset < 0) return; // not a toss pad — ignore

  if (status === 0x90 && vel > 0) {
    activePad = offset;
    host_module_send_midi([0x90, offset, vel], 'internal');
    setLED(note, ACTIVE_COLOR);
    needRedraw = true;
  } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
    if (offset === activePad) activePad = -1;
    host_module_send_midi([0x80, offset, 0], 'internal');
    setLED(note, IDLE_COLOR);
    needRedraw = true;
  }
};

globalThis.onMidiMessageExternal = function onMidiMessageExternal() {};

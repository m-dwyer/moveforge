// Solo-mode on-device UI for Lobber.
//
// Lobber is a *played* audio FX. The pad grid is laid out like the hardware it
// is modelled on: the top two rows (16 pads) are the toss/step grid — leftmost
// pad = "now" (offset 0) — and a function row underneath carries the discrete
// controls (mode, reverse, record-stop, mute, capture). Pad presses are blocked
// from Move (so a toss doesn't also trigger a Move track) and injected into the
// DSP as MIDI: the toss grid on channel 0 (note -> slice offset), the function
// row on channel 1 (note -> function index, matching lobber_handle_midi).

import { MovePads, Cyan, Red, Green, Blue, Purple, White } from '../../shared/constants.mjs';
import { setLED, clearAllLEDs } from '../../shared/input_filter.mjs';

const TOSS_PADS = 16;          // pads 0..15 act as toss positions (offsets 0..15)
const IDLE_COLOR = Cyan;       // dim grid showing the toss row
const ACTIVE_COLOR = Red;      // pad currently holding a toss

// Function row (pads 16..20). fn indices mirror the LOBBER_FN_* enum in the core.
// momentary: lit only while held. toggle/cycle: reflect the tracked state.
const FN_KEYS = [
  { pad: 16, fn: 0, name: 'MODE',    color: Green,  momentary: false },
  { pad: 17, fn: 1, name: 'REVERSE', color: Cyan,   momentary: true  },
  { pad: 18, fn: 2, name: 'FREEZE',  color: Blue,   momentary: true  },
  { pad: 19, fn: 3, name: 'MUTE',    color: Red,    momentary: false },
  { pad: 20, fn: 4, name: 'CAPTURE', color: Purple, momentary: true  },
];
const MODE_NAMES = ['Live', 'Loop', 'Slice'];

let activePad = -1;            // toss pad index currently held (-1 = none)
let modeIdx = 0;               // mirrors the DSP play mode (Live/Loop/Slice)
let muteOn = false;            // mirrors the DSP mute toggle
let held = {};                 // fn name -> true while a momentary key is held
let needRedraw = true;

// Pure mapping: a Move pad note -> slice offset, or -1 if it isn't a toss pad.
// The pad index is the offset, so the DSP (note % 16) lands on the same slice.
export function padToOffset(note) {
  const idx = MovePads.indexOf(note);
  if (idx < 0 || idx >= TOSS_PADS) return -1;
  return idx;
}

// Pure mapping: a Move pad note -> function descriptor, or null if not a fn pad.
export function padToFn(note) {
  const idx = MovePads.indexOf(note);
  if (idx < 0) return null;
  return FN_KEYS.find((k) => k.pad === idx) || null;
}

function lightFnKey(k) {
  let color;
  if (k.name === 'MUTE') color = muteOn ? Red : Green;         // green = audio passes
  else if (k.name === 'MODE') color = Green;
  else color = held[k.name] ? White : k.color;                 // momentary: bright when held
  setLED(MovePads[k.pad], color);
}

function lightGrid() {
  for (let i = 0; i < TOSS_PADS; i++) {
    setLED(MovePads[i], i === activePad ? ACTIVE_COLOR : IDLE_COLOR);
  }
  for (const k of FN_KEYS) lightFnKey(k);
}

globalThis.init = function init() {
  // Pads drive the effect, not Move's tracks.
  if (typeof host_pad_block === 'function') host_pad_block(true);
  clearAllLEDs();
  activePad = -1;
  modeIdx = 0;
  muteOn = false;
  held = {};
  lightGrid();
  needRedraw = true;
};

globalThis.tick = function tick() {
  if (!needRedraw) return;
  needRedraw = false;
  clear_screen();
  print(2, 2, 'Lobber — ' + MODE_NAMES[modeIdx], 1);
  const status = activePad >= 0 ? ('Lob slice ' + activePad)
                                : (muteOn ? 'Muted' : 'Hold a pad to lob');
  print(2, 18, status, 1);
};

globalThis.onMidiMessageInternal = function onMidiMessageInternal(data) {
  if (!data || data.length < 3) return;
  const status = data[0] & 0xF0;
  const note = data[1];
  const vel = data[2];
  const on = status === 0x90 && vel > 0;
  const off = status === 0x80 || (status === 0x90 && vel === 0);
  if (!on && !off) return; // only note on/off drive the surface

  // Function row (channel 1) — discrete controls.
  const fn = padToFn(note);
  if (fn) {
    host_module_send_midi([on ? 0x91 : 0x81, fn.fn, on ? vel : 0], 'internal');
    if (on) {
      if (fn.name === 'MODE') modeIdx = (modeIdx + 1) % MODE_NAMES.length;
      else if (fn.name === 'MUTE') muteOn = !muteOn;
      else if (fn.momentary) held[fn.name] = true;
    } else if (fn.momentary) {
      held[fn.name] = false;
    }
    lightFnKey(fn);
    needRedraw = true;
    return;
  }

  // Toss grid (channel 0) — note -> slice offset.
  const offset = padToOffset(note);
  if (offset < 0) return; // not a Lobber pad — ignore
  if (on) {
    activePad = offset;
    host_module_send_midi([0x90, offset, vel], 'internal');
    setLED(note, ACTIVE_COLOR);
    needRedraw = true;
  } else {
    if (offset === activePad) activePad = -1;
    host_module_send_midi([0x80, offset, 0], 'internal');
    setLED(note, IDLE_COLOR);
    needRedraw = true;
  }
};

globalThis.onMidiMessageExternal = function onMidiMessageExternal() {};

const fallbackParams = [
  { key: "volume", label: "Volume", type: "float", min: 0, max: 1, default: 0.75, step: 0.01 },
  { key: "ratio", label: "Ratio", type: "float", min: 0.25, max: 4, default: 1.5, step: 0.01 },
  { key: "fm", label: "FM", type: "float", min: 0, max: 1, default: 0.15, step: 0.01 },
  { key: "fold", label: "Fold", type: "float", min: 0, max: 1, default: 0.35, step: 0.01 },
  { key: "lpg", label: "LPG", type: "float", min: 0, max: 1, default: 0.55, step: 0.01 },
  { key: "decay", label: "Decay", type: "float", min: 0.02, max: 4, default: 0.45, step: 0.01 },
  { key: "release", label: "Release", type: "float", min: 0.02, max: 6, default: 0.8, step: 0.01 },
  { key: "bend_range", label: "Bend", type: "float", min: 0, max: 12, default: 2, step: 0.1 }
];

const fallbackPresets = [
  { name: "Init", params: { volume: 0.75, ratio: 1.5, fm: 0.15, fold: 0.35, lpg: 0.55, decay: 0.45, release: 0.8, bend_range: 2 } }
];

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const scales = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9]
};

const screen = document.getElementById("screen");
const ctx = screen.getContext("2d");
const knobsEl = document.getElementById("knobs");
const controlsEl = document.getElementById("controls");
const padsEl = document.getElementById("pads");
const stepsEl = document.getElementById("steps");
const statusEl = document.getElementById("status");
const presetEl = document.getElementById("presets");
const audioToggle = document.getElementById("audioToggle");
const errorEl = document.getElementById("errors");
const previewEl = document.getElementById("previewList");
const chainEl = document.getElementById("chain");
const chainInspectorEl = document.getElementById("chainInspector");
const tracksEl = document.getElementById("tracks");
const layoutModeEl = document.getElementById("layoutMode");
const rootNoteEl = document.getElementById("rootNote");
const scaleNameEl = document.getElementById("scaleName");
const octaveBaseEl = document.getElementById("octaveBase");
const stepInspectorEl = document.getElementById("stepInspector");

let params = [];
let presets = [];
let audio = null;
let node = null;
let audioReady = false;
let midiAccess = null;
let seqTimer = null;

const state = {
  mode: "device",
  page: 0,
  selectedTrack: 0,
  selectedSlot: 1,
  selectedPreset: "Init",
  browserIndex: 0,
  touchedParam: null,
  shift: false,
  record: false,
  playing: false,
  loop: false,
  mute: false,
  selectedStep: 0,
  playStep: -1,
  padLayout: "in-key-octaves",
  root: 0,
  scale: "major",
  octave: 3,
  chain: [
    { id: "midi-pre", type: "MIDI FX", name: "Scale Gate", enabled: false },
    { id: "westfold", type: "Sound", name: "Westfold", enabled: true },
    { id: "audio-post", type: "Audio FX", name: "Drive Tone", enabled: false }
  ],
  midiFx: {
    transpose: 0,
    chance: 1,
    velocity: 1,
    scaleLock: true
  },
  audioFx: {
    drive: 0.35,
    tone: 0.72,
    wet: 0.55
  },
  steps: Array.from({ length: 16 }, () => ({ enabled: false, note: 60, velocity: 0.9, locks: {} })),
  activePads: new Map(),
  activeNotes: new Map()
};

function showError(message) {
  errorEl.textContent = message || "";
  errorEl.hidden = !message;
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function paramDefaultsFromModule(moduleJson) {
  const levels = moduleJson?.capabilities?.ui_hierarchy?.levels || {};
  const root = levels.root || {};
  return (root.params || [])
    .filter((item) => item.key)
    .map((item) => ({ ...item, value: item.default }));
}

async function loadMetadata() {
  try {
    const [moduleJson, presetJson] = await Promise.all([
      loadJson("../src/module.json"),
      loadJson("../src/presets.json")
    ]);
    params = paramDefaultsFromModule(moduleJson);
    presets = presetJson.presets || fallbackPresets;
    state.selectedPreset = presets[0]?.name || "Init";
    state.browserIndex = 0;
    applyPreset(state.selectedPreset, false);
    renderPreviewList();
  } catch (error) {
    params = fallbackParams.map((p) => ({ ...p, value: p.default }));
    presets = fallbackPresets;
    showError(`Metadata fallback: ${error.message}`);
  }
}

function norm(param) {
  return (param.value - param.min) / (param.max - param.min);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function format(param) {
  if (param.key === "bend_range") return Number(param.value).toFixed(1);
  if (param.max > 3) return Number(param.value).toFixed(2);
  return Number(param.value).toFixed(2);
}

function visibleParams() {
  return params.slice(state.page * 8, state.page * 8 + 8);
}

function pageCount() {
  return Math.max(1, Math.ceil(params.length / 8));
}

function drawHeader(title, subtitle = "") {
  ctx.fillStyle = "#d8ddd0";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#151713";
  ctx.font = "15px Menlo, monospace";
  ctx.fillText(title, 8, 18);
  ctx.font = "10px Menlo, monospace";
  if (subtitle) ctx.fillText(subtitle.slice(0, 34), 8, 34);
  ctx.fillRect(8, 41, 240, 1);
}

function drawScreen() {
  if (state.mode === "chain") return drawChainScreen();
  if (state.mode === "seq") return drawSeqScreen();
  if (state.mode === "browser") return drawBrowserScreen();
  return drawDeviceScreen();
}

function drawDeviceScreen() {
  const touched = state.touchedParam;
  drawHeader("Westfold", `${state.selectedPreset}  T${state.selectedTrack + 1}  Pg ${state.page + 1}/${pageCount()}`);
  const visible = visibleParams();
  visible.forEach((param, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const cellX = 8 + col * 60;
    const cellY = 50 + row * 35;
    const cellW = 56;
    const value = format(param);
    const fill = Math.round(norm(param) * (cellW - 6));
    if (touched?.key === param.key) {
      ctx.fillStyle = "#151713";
      ctx.fillRect(cellX - 2, cellY - 2, cellW + 4, 29);
      ctx.fillStyle = "#d8ddd0";
    }

    ctx.font = "8px Menlo, monospace";
    ctx.fillText(param.label.slice(0, 6), cellX, cellY + 8);
    ctx.textAlign = "right";
    ctx.fillText(value.slice(0, 5), cellX + cellW, cellY + 8);
    ctx.textAlign = "left";
    ctx.strokeStyle = ctx.fillStyle;
    ctx.strokeRect(cellX, cellY + 14, cellW, 8);
    ctx.fillRect(cellX + 3, cellY + 17, fill, 3);
    ctx.fillStyle = "#151713";
    ctx.strokeStyle = "#151713";
  });
  ctx.font = "10px Menlo, monospace";
}

function drawChainScreen() {
  drawHeader("Schwung Chain", "Long Track/Menu equivalent");
  state.chain.forEach((slot, i) => {
    const y = 58 + i * 21;
    const selected = i === state.selectedSlot;
    if (selected) {
      ctx.fillStyle = "#151713";
      ctx.fillRect(8, y - 13, 240, 17);
      ctx.fillStyle = "#d8ddd0";
    }
    const enabled = slot.enabled ? "ON " : "OFF";
    ctx.fillText(`${i + 1} ${slot.type.padEnd(8)} ${enabled} ${slot.name}`, 12, y);
    ctx.fillStyle = "#151713";
  });
  ctx.fillText("Wheel: select  Press: bypass", 12, 120);
}

function drawSeqScreen() {
  drawHeader("Step Harness", `${state.playing ? "PLAY" : "STOP"} ${state.record ? "REC" : ""} Step ${state.selectedStep + 1}`);
  for (let i = 0; i < 16; i++) {
    const x = 10 + (i % 8) * 30;
    const y = i < 8 ? 58 : 87;
    const step = state.steps[i];
    const active = i === state.playStep;
    const selected = i === state.selectedStep;
    ctx.strokeRect(x, y - 12, 22, 14);
    if (step.enabled || active || selected) {
      ctx.fillStyle = active ? "#151713" : selected ? "#777b70" : "#151713";
      ctx.fillRect(x + 2, y - 10, 18, 10);
      ctx.fillStyle = active ? "#d8ddd0" : "#151713";
    }
    ctx.fillText(String(i + 1).padStart(2, "0"), x + 2, y + 12);
    if (Object.keys(step.locks).length) ctx.fillText("*", x + 17, y + 12);
    ctx.fillStyle = "#151713";
  }
}

function drawBrowserScreen() {
  drawHeader("Preset Browser", "Wheel previews, press loads");
  presets.slice(0, 5).forEach((preset, i) => {
    const idx = (state.browserIndex + i) % presets.length;
    const y = 58 + i * 13;
    const selected = i === 0;
    if (selected) {
      ctx.fillStyle = "#151713";
      ctx.fillRect(8, y - 10, 240, 12);
      ctx.fillStyle = "#d8ddd0";
    }
    ctx.fillText(presets[idx].name, 12, y);
    ctx.fillStyle = "#151713";
  });
  ctx.fillText(`Loaded: ${state.selectedPreset}`.slice(0, 30), 12, 120);
}

function renderTracks() {
  tracksEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `track ${i === state.selectedTrack ? "selected" : ""}`;
    button.textContent = `Track ${i + 1}`;
    button.addEventListener("click", () => {
      state.selectedTrack = i;
      update();
    });
    tracksEl.appendChild(button);
  }
}

function renderChain() {
  chainEl.innerHTML = "";
  state.chain.forEach((slot, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chain-slot ${i === state.selectedSlot ? "selected" : ""} ${slot.enabled ? "" : "disabled"}`;
    button.innerHTML = `<span>${slot.type}</span><b>${slot.name}</b><small>${slot.enabled ? "enabled" : "bypassed"}</small>`;
    button.addEventListener("click", () => {
      state.selectedSlot = i;
      state.mode = "chain";
      syncAudioFx();
      update();
    });
    button.addEventListener("dblclick", () => {
      slot.enabled = !slot.enabled;
      syncAudioFx();
      update();
    });
    chainEl.appendChild(button);
  });
}

function renderChainInspector() {
  const slot = state.chain[state.selectedSlot];
  if (!slot) {
    chainInspectorEl.innerHTML = "";
    return;
  }

  if (slot.id === "midi-pre") {
    chainInspectorEl.innerHTML = `
      <div class="chain-inspector-head">
        <b>Scale Gate</b>
        <span>${slot.enabled ? "in MIDI path" : "bypassed"}</span>
      </div>
      <div class="mini-controls">
        <label>Transpose <input data-midi-fx="transpose" type="range" min="-24" max="24" step="1" value="${state.midiFx.transpose}"><span>${state.midiFx.transpose}</span></label>
        <label>Chance <input data-midi-fx="chance" type="range" min="0" max="1" step="0.01" value="${state.midiFx.chance}"><span>${state.midiFx.chance.toFixed(2)}</span></label>
        <label>Velocity <input data-midi-fx="velocity" type="range" min="0.1" max="1.5" step="0.01" value="${state.midiFx.velocity}"><span>${state.midiFx.velocity.toFixed(2)}</span></label>
        <label class="check-row"><input data-midi-fx="scaleLock" type="checkbox" ${state.midiFx.scaleLock ? "checked" : ""}> Scale lock</label>
      </div>
    `;
    chainInspectorEl.querySelectorAll("[data-midi-fx]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.dataset.midiFx;
        state.midiFx[key] = input.type === "checkbox" ? input.checked : Number(input.value);
        update();
      });
    });
    return;
  }

  if (slot.id === "audio-post") {
    chainInspectorEl.innerHTML = `
      <div class="chain-inspector-head">
        <b>Drive Tone</b>
        <span>${slot.enabled ? "post synth" : "bypassed"}</span>
      </div>
      <div class="mini-controls">
        <label>Drive <input data-audio-fx="drive" type="range" min="0" max="1" step="0.01" value="${state.audioFx.drive}"><span>${state.audioFx.drive.toFixed(2)}</span></label>
        <label>Tone <input data-audio-fx="tone" type="range" min="0" max="1" step="0.01" value="${state.audioFx.tone}"><span>${state.audioFx.tone.toFixed(2)}</span></label>
        <label>Wet <input data-audio-fx="wet" type="range" min="0" max="1" step="0.01" value="${state.audioFx.wet}"><span>${state.audioFx.wet.toFixed(2)}</span></label>
      </div>
    `;
    chainInspectorEl.querySelectorAll("[data-audio-fx]").forEach((input) => {
      input.addEventListener("input", () => {
        state.audioFx[input.dataset.audioFx] = Number(input.value);
        syncAudioFx();
        update();
      });
    });
    return;
  }

  chainInspectorEl.innerHTML = `
    <div class="chain-inspector-head">
      <b>Westfold</b>
      <span>shared C DSP core via WASM</span>
    </div>
  `;
}

function renderKnobs() {
  knobsEl.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const param = visibleParams()[i];
    const el = document.createElement("button");
    el.type = "button";
    el.className = "knob";
    if (!param) {
      el.innerHTML = `<div class="dial empty"></div><span>-</span>`;
      knobsEl.appendChild(el);
      continue;
    }
    const angle = 270 * norm(param);
    el.innerHTML = `<div class="dial" style="--angle:${angle}deg"></div><span>${param.label}</span>`;
    el.addEventListener("pointerenter", () => {
      state.touchedParam = param;
      update(false);
    });
    el.addEventListener("pointerleave", () => {
      state.touchedParam = null;
      update(false);
    });
    el.addEventListener("wheel", (event) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      adjustParam(param, direction * Number(param.step || 0.01));
    });
    el.addEventListener("click", () => {
      state.touchedParam = param;
      update();
    });
    knobsEl.appendChild(el);
  }
}

function renderControls() {
  controlsEl.innerHTML = "";
  params.forEach((param) => {
    const control = document.createElement("label");
    control.className = "control";
    control.innerHTML = `
      <div class="control-head">
        <b>${param.label}</b>
        <span>${format(param)}</span>
      </div>
      <input type="range" min="${param.min}" max="${param.max}" step="${param.step || 0.01}" value="${param.value}">
    `;
    const input = control.querySelector("input");
    input.addEventListener("input", () => {
      setParamValue(param, Number(input.value), true);
    });
    controlsEl.appendChild(control);
  });
}

function renderPresets() {
  presetEl.innerHTML = "";
  presets.forEach((preset, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.name;
    button.className = preset.name === state.selectedPreset ? "selected" : "";
    button.addEventListener("click", () => {
      state.browserIndex = index;
      applyPreset(preset.name);
    });
    presetEl.appendChild(button);
  });
}

function renderPreviewList() {
  previewEl.innerHTML = "";
  presets.forEach((preset) => {
    const file = preset.render?.file;
    if (!file) return;
    const audioEl = document.createElement("audio");
    audioEl.controls = true;
    audioEl.src = `../renders/westfold-suite/${file}`;
    previewEl.appendChild(audioEl);
  });
}

function renderSteps() {
  stepsEl.innerHTML = "";
  state.steps.forEach((step, i) => {
    const button = document.createElement("button");
    button.type = "button";
    const locked = Object.keys(step.locks).length > 0;
    button.className = `step ${step.enabled ? "enabled" : ""} ${i === state.selectedStep ? "selected" : ""} ${i === state.playStep ? "playing" : ""} ${locked ? "locked" : ""}`;
    button.textContent = String(i + 1).padStart(2, "0");
    button.addEventListener("click", () => {
      state.selectedStep = i;
      if (state.shift) {
        step.locks = {};
      } else {
        step.enabled = !step.enabled;
        if (state.activePads.size) step.note = [...state.activePads.values()][0];
      }
      update();
    });
    stepsEl.appendChild(button);
  });
}

function noteForPad(index) {
  const rootMidi = 12 * (state.octave + 1) + state.root;
  if (state.padLayout === "chromatic") {
    const row = Math.floor(index / 8);
    const col = index % 8;
    return rootMidi + row * 5 + col;
  }
  const scale = scales[state.scale] || scales.major;
  if (state.padLayout === "in-key-fourths") {
    const row = Math.floor(index / 8);
    const col = index % 8;
    const degree = col + row * 3;
    return rootMidi + 12 * Math.floor(degree / scale.length) + scale[degree % scale.length];
  }
  const degree = index % 8;
  const row = Math.floor(index / 8);
  const wrapped = degree % scale.length;
  const extraOctave = Math.floor(degree / scale.length);
  return rootMidi + row * 12 + extraOctave * 12 + scale[wrapped];
}

function isRoot(note) {
  return ((note - state.root) % 12 + 12) % 12 === 0;
}

function isInScale(note) {
  const pc = ((note - state.root) % 12 + 12) % 12;
  return (scales[state.scale] || scales.major).includes(pc);
}

function renderPads() {
  padsEl.innerHTML = "";
  for (let i = 0; i < 32; i++) {
    const note = noteForPad(i);
    const pad = document.createElement("button");
    pad.type = "button";
    pad.className = `pad playable ${isRoot(note) ? "root" : ""} ${isInScale(note) ? "scale" : "outside"} ${state.activePads.has(i) ? "active" : ""}`;
    pad.title = `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`;
    pad.textContent = noteNames[note % 12];
    pad.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      state.activePads.set(i, note);
      state.steps[state.selectedStep].note = note;
      noteOn(note, event.pressure && event.pressure > 0 ? clamp(event.pressure, 0.25, 1) : 0.94);
      update();
    });
    const end = () => {
      state.activePads.delete(i);
      noteOff(note);
      update();
    };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointerleave", end);
    padsEl.appendChild(pad);
  }
}

function renderStepInspector() {
  const step = state.steps[state.selectedStep];
  const locks = Object.entries(step.locks)
    .map(([key, value]) => `${key}=${Number(value).toFixed(2)}`)
    .join(", ");
  stepInspectorEl.textContent = `Step ${state.selectedStep + 1}: ${step.enabled ? "on" : "off"} note ${step.note} velocity ${step.velocity.toFixed(2)}${locks ? ` locks ${locks}` : ""}`;
}

function update(renderForms = true) {
  statusEl.textContent = `${state.mode[0].toUpperCase()}${state.mode.slice(1)}${state.shift ? " + Shift" : ""}`;
  document.querySelectorAll(".mode-key").forEach((button) => {
    button.classList.toggle("selected", button.dataset.mode === state.mode);
  });
  document.getElementById("shiftKey").classList.toggle("selected", state.shift);
  document.getElementById("recordKey").classList.toggle("selected", state.record);
  document.getElementById("playKey").classList.toggle("selected", state.playing);
  document.getElementById("loopKey").classList.toggle("selected", state.loop);
  document.getElementById("muteKey").classList.toggle("selected", state.mute);
  drawScreen();
  renderTracks();
  renderChain();
  renderChainInspector();
  renderKnobs();
  renderSteps();
  renderPads();
  renderStepInspector();
  if (renderForms) {
    renderControls();
    renderPresets();
  }
}

function send(message) {
  if (node) node.port.postMessage(message);
}

function sendParam(param) {
  send({ type: "param", key: param.key, value: param.value });
}

function midiFxSlot() {
  return state.chain.find((slot) => slot.id === "midi-pre");
}

function audioFxSlot() {
  return state.chain.find((slot) => slot.id === "audio-post");
}

function nearestScaleNote(note) {
  const allowed = scales[state.scale] || scales.major;
  let best = note;
  let bestDistance = Infinity;
  for (let candidate = note - 6; candidate <= note + 6; candidate++) {
    const pc = ((candidate - state.root) % 12 + 12) % 12;
    const distance = Math.abs(candidate - note);
    if (allowed.includes(pc) && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function processMidiFx(note, velocity) {
  const slot = midiFxSlot();
  if (!slot?.enabled) return { note, velocity };
  if (Math.random() > state.midiFx.chance) return null;
  let processedNote = clamp(note + state.midiFx.transpose, 0, 127);
  if (state.midiFx.scaleLock) processedNote = nearestScaleNote(processedNote);
  return {
    note: processedNote,
    velocity: clamp(velocity * state.midiFx.velocity, 0, 1)
  };
}

function syncAudioFx() {
  send({
    type: "audioFx",
    enabled: Boolean(audioFxSlot()?.enabled),
    ...state.audioFx
  });
}

function setParamValue(param, value, markCustom = false) {
  param.value = clamp(value, param.min, param.max);
  if (markCustom) state.selectedPreset = "Custom";
  if (state.record && state.mode === "seq") {
    state.steps[state.selectedStep].locks[param.key] = param.value;
  }
  sendParam(param);
  update();
}

function adjustParam(param, delta) {
  const multiplier = state.shift ? 0.1 : 1;
  setParamValue(param, param.value + delta * multiplier, true);
}

function applyPreset(name, shouldUpdate = true) {
  const preset = presets.find((p) => p.name === name);
  if (!preset) return;
  state.selectedPreset = name;
  Object.entries(preset.params || {}).forEach(([key, value]) => {
    const param = params.find((p) => p.key === key);
    if (param) {
      param.value = value;
      sendParam(param);
    }
  });
  if (shouldUpdate) update();
}

async function enableAudio() {
  if (audioReady) {
    await audio.resume();
    return;
  }
  showError("");
  audioToggle.textContent = "Loading WASM...";
  const wasmResponse = await fetch("wasm/westfold.wasm", { cache: "no-store" });
  if (!wasmResponse.ok) throw new Error(`Could not load WASM: ${wasmResponse.status}`);
  const wasmBytes = await wasmResponse.arrayBuffer();
  audio = new AudioContext({ sampleRate: 44100 });
  await audio.audioWorklet.addModule(`westfold-worklet.js?v=${Date.now()}`);
  node = new AudioWorkletNode(audio, "westfold-processor", {
    numberOfOutputs: 1,
    outputChannelCount: [2]
  });
  node.connect(audio.destination);
  node.port.onmessage = (event) => {
    if (event.data?.type === "needWasm") {
      node.port.postMessage({ type: "loadWasm", bytes: wasmBytes }, [wasmBytes]);
    } else if (event.data?.type === "ready") {
      audioReady = true;
      audioToggle.textContent = "WASM Audio On";
      params.forEach(sendParam);
      syncAudioFx();
    } else if (event.data?.type === "error") {
      audioToggle.textContent = "Audio failed";
      showError(event.data.message);
    }
  };
}

function noteOn(note, velocity = 0.94) {
  enableAudio().then(() => {
    const processed = processMidiFx(note, velocity);
    if (!processed) return;
    state.activeNotes.set(note, processed.note);
    send({ type: "noteOn", note: processed.note, velocity: processed.velocity });
  }).catch((error) => {
    audioToggle.textContent = "Audio failed";
    showError(error.message);
  });
}

function noteOff(note) {
  const processedNote = state.activeNotes.get(note) ?? note;
  state.activeNotes.delete(note);
  send({ type: "noteOff", note: processedNote });
}

async function enableMidi() {
  if (!navigator.requestMIDIAccess) {
    showError("Web MIDI is not available in this browser.");
    return;
  }
  midiAccess = await navigator.requestMIDIAccess();
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = onMidiMessage;
  }
  midiAccess.onstatechange = () => {
    for (const input of midiAccess.inputs.values()) input.onmidimessage = onMidiMessage;
  };
}

function onMidiMessage(event) {
  const [status, d1, d2] = event.data;
  const type = status & 0xF0;
  if (type === 0x90 && d2 > 0) noteOn(d1, d2 / 127);
  else if (type === 0x80 || (type === 0x90 && d2 === 0)) noteOff(d1);
  else if (type === 0xB0) {
    const index = d1 >= 20 && d1 < 28 ? d1 - 20 : -1;
    const param = visibleParams()[index] || params[index];
    if (param) setParamValue(param, param.min + (d2 / 127) * (param.max - param.min), true);
  } else if (type === 0xE0) {
    const bend = (((d2 << 7) | d1) - 8192) / 8192;
    send({ type: "pitchBend", value: bend });
  }
}

function sequencerTick() {
  state.playStep = (state.playStep + 1) % 16;
  const step = state.steps[state.playStep];
  send({ type: "allNotesOff" });
  if (step.enabled && !state.mute) {
    Object.entries(step.locks).forEach(([key, value]) => {
      const param = params.find((p) => p.key === key);
      if (param) {
        param.value = value;
        sendParam(param);
      }
    });
    noteOn(step.note, step.velocity);
    setTimeout(() => noteOff(step.note), 150);
  }
  update(false);
}

function setPlaying(playing) {
  state.playing = playing;
  if (seqTimer) clearInterval(seqTimer);
  seqTimer = null;
  if (playing) {
    state.playStep = -1;
    sequencerTick();
    seqTimer = setInterval(sequencerTick, 240);
  } else {
    state.playStep = -1;
    send({ type: "allNotesOff" });
  }
  update();
}

function moveWheel(direction) {
  if (state.mode === "device") {
    state.page = clamp(state.page + direction, 0, pageCount() - 1);
  } else if (state.mode === "chain") {
    state.selectedSlot = clamp(state.selectedSlot + direction, 0, state.chain.length - 1);
  } else if (state.mode === "seq") {
    state.selectedStep = clamp(state.selectedStep + direction, 0, 15);
  } else if (state.mode === "browser" && presets.length) {
    state.browserIndex = (state.browserIndex + direction + presets.length) % presets.length;
  }
  update();
}

function pressWheel() {
  if (state.mode === "chain") {
    const slot = state.chain[state.selectedSlot];
    slot.enabled = !slot.enabled;
    syncAudioFx();
  } else if (state.mode === "seq") {
    const step = state.steps[state.selectedStep];
    step.enabled = !step.enabled;
  } else if (state.mode === "browser") {
    applyPreset(presets[state.browserIndex]?.name);
    return;
  }
  update();
}

function initRootOptions() {
  noteNames.forEach((name, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = name;
    rootNoteEl.appendChild(option);
  });
}

function bindControls() {
  document.getElementById("prevPage").addEventListener("click", () => moveWheel(-1));
  document.getElementById("nextPage").addEventListener("click", () => moveWheel(1));
  document.getElementById("wheelLeft").addEventListener("click", () => moveWheel(-1));
  document.getElementById("wheelRight").addEventListener("click", () => moveWheel(1));
  document.getElementById("wheelPress").addEventListener("click", pressWheel);
  document.getElementById("backKey").addEventListener("click", () => {
    state.mode = "device";
    update();
  });
  document.getElementById("shiftKey").addEventListener("click", () => {
    state.shift = !state.shift;
    update();
  });
  document.getElementById("recordKey").addEventListener("click", () => {
    state.record = !state.record;
    update();
  });
  document.getElementById("playKey").addEventListener("click", () => setPlaying(!state.playing));
  document.getElementById("captureKey").addEventListener("click", () => {
    state.mode = "seq";
    state.record = true;
    update();
  });
  document.getElementById("loopKey").addEventListener("click", () => {
    state.loop = !state.loop;
    update();
  });
  document.getElementById("muteKey").addEventListener("click", () => {
    state.mute = !state.mute;
    update();
  });
  document.getElementById("deleteKey").addEventListener("click", () => {
    state.steps[state.selectedStep] = { enabled: false, note: 60, velocity: 0.9, locks: {} };
    update();
  });
  document.getElementById("clearSteps").addEventListener("click", () => {
    state.steps = Array.from({ length: 16 }, () => ({ enabled: false, note: 60, velocity: 0.9, locks: {} }));
    update();
  });
  document.querySelectorAll(".mode-key").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      update();
    });
  });
  layoutModeEl.addEventListener("change", () => {
    state.padLayout = layoutModeEl.value;
    update();
  });
  rootNoteEl.addEventListener("change", () => {
    state.root = Number(rootNoteEl.value);
    update();
  });
  scaleNameEl.addEventListener("change", () => {
    state.scale = scaleNameEl.value;
    update();
  });
  octaveBaseEl.addEventListener("change", () => {
    state.octave = Number(octaveBaseEl.value);
    update();
  });
  audioToggle.addEventListener("click", () => {
    enableAudio()
      .then(enableMidi)
      .catch((error) => {
        audioToggle.textContent = "Audio failed";
        showError(error.message);
      });
  });
}

const keyMap = {
  a: 0, w: 1, s: 2, d: 3, r: 4, f: 5, t: 6, g: 7,
  h: 8, u: 9, j: 10, i: 11, k: 12, o: 13, l: 14, ";": 15
};

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.key === "ArrowLeft") return moveWheel(-1);
  if (event.key === "ArrowRight") return moveWheel(1);
  if (event.key === "Enter") return pressWheel();
  if (event.key === " ") {
    event.preventDefault();
    return setPlaying(!state.playing);
  }
  const padIndex = keyMap[event.key];
  if (padIndex !== undefined) {
    const note = noteForPad(padIndex);
    state.activePads.set(padIndex, note);
    noteOn(note);
    update();
  }
});

window.addEventListener("keyup", (event) => {
  const padIndex = keyMap[event.key];
  if (padIndex !== undefined) {
    const note = noteForPad(padIndex);
    state.activePads.delete(padIndex);
    noteOff(note);
    update();
  }
});

initRootOptions();
bindControls();
await loadMetadata();
update();

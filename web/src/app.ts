// @ts-nocheck
import { AudioEngine } from "./audio-engine.js";
import { loadModuleIndex as fetchModuleIndex, loadModuleMetadata } from "./module-metadata.js";

const moduleId = new URLSearchParams(window.location.search).get("module") || "westfold";
const workletUrl = new URLSearchParams(window.location.search).get("worklet") || "module-worklet.js";
const workletProcessor = new URLSearchParams(window.location.search).get("processor") || "module-processor";
let activeModuleName = moduleId.replace(/(^|-)([a-z])/g, (_match, _dash, letter) => letter.toUpperCase());

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const scales = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9]
};

const midiFxParamDefs = [
  { scope: "component", key: "transpose", label: "Transpose", min: -24, max: 24, default: 0, step: 1 },
  { scope: "component", key: "chance", label: "Chance", min: 0, max: 1, default: 1, step: 0.01 },
  { scope: "component", key: "velocity", label: "Velocity", min: 0.1, max: 1.5, default: 1, step: 0.01 }
];

const audioFxParamDefs = [
  { scope: "component", key: "drive", label: "Drive", min: 0, max: 1, default: 0.35, step: 0.01 },
  { scope: "component", key: "tone", label: "Tone", min: 0, max: 1, default: 0.72, step: 0.01 },
  { scope: "component", key: "wet", label: "Wet", min: 0, max: 1, default: 0.55, step: 0.01 }
];

const settingsParamDefs = [
  { scope: "settings", key: "slot_volume", label: "Slot Vol", min: 0, max: 1, default: 1, step: 0.01 },
  { scope: "settings", key: "receive_ch", label: "Recv Ch", min: 0, max: 16, default: 0, step: 1 },
  { scope: "settings", key: "forward_ch", label: "Fwd Ch", min: 0, max: 17, default: 0, step: 1 },
  { scope: "settings", key: "midi_fx_output", label: "MIDI Out", min: 0, max: 1, default: 0, step: 1 },
  { scope: "settings", key: "lfo1_depth", label: "LFO 1", min: 0, max: 1, default: 0, step: 0.01 },
  { scope: "settings", key: "lfo2_depth", label: "LFO 2", min: 0, max: 1, default: 0, step: 0.01 }
];

const screen = document.getElementById("screen");
const ctx = screen.getContext("2d");
const knobsEl = document.getElementById("knobs");
const controlsEl = document.getElementById("controls");
const padsEl = document.getElementById("pads");
const stepsEl = document.getElementById("steps");
const statusEl = document.getElementById("status");
const panelTitleEl = document.getElementById("panelTitle");
const presetEl = document.getElementById("presets");
const audioToggle = document.getElementById("audioToggle");
const errorEl = document.getElementById("errors");
const previewEl = document.getElementById("previewList");
const chainEl = document.getElementById("chain");
const chainInspectorEl = document.getElementById("chainInspector");
const tracksEl = document.getElementById("tracks");
const moduleNameEl = document.getElementById("moduleName");
const moduleSelectEl = document.getElementById("moduleSelect");
const layoutModeEl = document.getElementById("layoutMode");
const rootNoteEl = document.getElementById("rootNote");
const scaleNameEl = document.getElementById("scaleName");
const octaveBaseEl = document.getElementById("octaveBase");
const stepInspectorEl = document.getElementById("stepInspector");

let params = [];
let paramIds = {};
let presets = [];
const audioEngine = new AudioEngine();
let midiAccess = null;
let seqTimer = null;

function makeMidiFx() {
  return {
    id: "midi-pre",
    kind: "midi_fx",
    type: "MIDI FX",
    name: "Scale Gate",
    enabled: false,
    scaleLock: true,
    params: { transpose: 0, chance: 1, velocity: 1 }
  };
}

function makeSound() {
  return { id: moduleId, kind: "sound_generator", type: "Sound", name: activeModuleName, enabled: true };
}

function makeAudioFx(id, label, defaults = {}) {
  return {
    id,
    kind: "audio_fx",
    type: label,
    name: id === "audio-fx-2" ? "Air Tone" : "Drive Tone",
    enabled: false,
    params: { drive: 0.35, tone: 0.72, wet: 0.55, ...defaults }
  };
}

function makeSettings() {
  return {
    id: "settings",
    kind: "settings",
    type: "Settings",
    name: "Slot Settings",
    enabled: true,
    params: {
      slot_volume: 1,
      receive_ch: 0,
      forward_ch: 0,
      midi_fx_output: 0,
      lfo1_depth: 0,
      lfo2_depth: 0
    },
    lfos: [
      { enabled: false, targetComponent: moduleId, targetParam: "fold", shape: "sine", depth: 0, rate: 0.25, phase: 0, polarity: "bipolar", retrigger: false },
      { enabled: false, targetComponent: "audio-fx-1", targetParam: "wet", shape: "tri", depth: 0, rate: 0.125, phase: 0, polarity: "unipolar", retrigger: false }
    ]
  };
}

function makeSlotState() {
  return {
    chain: [
      makeMidiFx(),
      makeSound(),
      makeAudioFx("audio-fx-1", "Audio FX 1"),
      makeAudioFx("audio-fx-2", "Audio FX 2", { drive: 0.08, tone: 0.9, wet: 0.25 }),
      makeSettings()
    ],
    activeNotes: new Map(),
    moveEchoEvents: []
  };
}

function makeMasterState() {
  return {
    chain: [
      makeAudioFx("master-fx-1", "Master FX 1", { drive: 0.1, wet: 0.25 }),
      makeAudioFx("master-fx-2", "Master FX 2", { drive: 0.2, wet: 0.2 }),
      makeAudioFx("master-fx-3", "Master FX 3", { drive: 0, tone: 0.6, wet: 0 }),
      makeAudioFx("master-fx-4", "Master FX 4", { drive: 0, tone: 0.6, wet: 0 })
    ]
  };
}

const state = {
  mode: "device",
  context: "slot",
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
  tracks: Array.from({ length: 4 }, makeSlotState),
  master: makeMasterState(),
  steps: Array.from({ length: 16 }, () => ({ enabled: false, note: 60, velocity: 0.9, locks: {} })),
  activePads: new Map()
};

function showError(message) {
  errorEl.textContent = message || "";
  errorEl.hidden = !message;
}

async function loadMetadata() {
  const metadata = await loadModuleMetadata(moduleId);
  const { moduleJson } = metadata;
  activeModuleName = moduleJson.name || activeModuleName;
  document.title = `${activeModuleName} Move/Schwung Emulator`;
  if (moduleNameEl) moduleNameEl.textContent = activeModuleName;
  for (const track of state.tracks) {
    const sound = track.chain.find((slot) => slot.kind === "sound_generator");
    if (sound) {
      sound.id = moduleJson.id || moduleId;
      sound.name = activeModuleName;
    }
    const settings = track.chain.find((slot) => slot.kind === "settings");
    if (settings?.lfos?.[0]) settings.lfos[0].targetComponent = moduleJson.id || moduleId;
  }
  params = metadata.params;
  paramIds = metadata.paramIds;
  const lfoTarget = params[Math.min(3, params.length - 1)]?.key || params[0]?.key || "";
  for (const track of state.tracks) {
    const settings = track.chain.find((slot) => slot.kind === "settings");
    if (settings?.lfos?.[0]) settings.lfos[0].targetParam = lfoTarget;
  }
  presets = metadata.presets;
  state.selectedPreset = presets[0]?.name || "Init";
  state.browserIndex = 0;
  applyPreset(state.selectedPreset, false);
  renderPreviewList();
}

async function loadModuleIndex() {
  if (!moduleSelectEl) return;
  try {
    const index = await fetchModuleIndex();
    moduleSelectEl.innerHTML = "";
    for (const item of index.modules || []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || item.id;
      option.selected = item.id === moduleId;
      moduleSelectEl.appendChild(option);
    }
    if (!moduleSelectEl.value) moduleSelectEl.value = moduleId;
  } catch (error) {
    moduleSelectEl.innerHTML = "";
    const option = document.createElement("option");
    option.value = moduleId;
    option.textContent = activeModuleName;
    moduleSelectEl.appendChild(option);
    showError(`Module index fallback: ${error.message}`);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function norm(param) {
  if (param.max === param.min) return 0;
  return (param.value - param.min) / (param.max - param.min);
}

function currentSlotState() {
  return state.context === "master" ? state.master : state.tracks[state.selectedTrack];
}

function currentChain() {
  return currentSlotState().chain;
}

function selectedSlot() {
  return currentChain()[state.selectedSlot];
}

function settingsComponent() {
  return state.tracks[state.selectedTrack].chain.find((slot) => slot.kind === "settings");
}

function scopedParams(defs, values, component) {
  return defs.map((def) => ({ ...def, componentId: component?.id, value: values[def.key] ?? def.default }));
}

function format(param) {
  if (param.key === "transpose") return `${Number(param.value) > 0 ? "+" : ""}${Number(param.value).toFixed(0)}`;
  if (param.key === "receive_ch") return Number(param.value) === 0 ? "All" : String(Number(param.value).toFixed(0));
  if (param.key === "forward_ch") {
    if (Number(param.value) === 0) return "Auto";
    if (Number(param.value) === 1) return "Thru";
    return `Ch ${Number(param.value) - 1}`;
  }
  if (param.key === "midi_fx_output") return Number(param.value) < 0.5 ? "Schw" : "Both";
  if (param.key === "bend_range") return Number(param.value).toFixed(1);
  if (param.max > 3) return Number(param.value).toFixed(2);
  return Number(param.value).toFixed(2);
}

function activeParams() {
  const slot = selectedSlot();
  if (state.mode === "chain" && slot?.kind === "midi_fx") return scopedParams(midiFxParamDefs, slot.params, slot);
  if (state.mode === "chain" && slot?.kind === "audio_fx") return scopedParams(audioFxParamDefs, slot.params, slot);
  if (state.mode === "chain" && slot?.kind === "settings") return scopedParams(settingsParamDefs, slot.params, slot);
  return params;
}

function activeDeviceName() {
  const slot = selectedSlot();
  if (state.mode === "chain" && slot) return slot.name;
  return activeModuleName;
}

function selectedScopedSlotIsBypassed() {
  const slot = selectedSlot();
  return state.mode === "chain" && Boolean(slot) && slot.kind !== "settings" && !slot.enabled;
}

function visibleParams() {
  return activeParams().slice(state.page * 8, state.page * 8 + 8);
}

function pageCount() {
  return Math.max(1, Math.ceil(activeParams().length / 8));
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
  drawHeader(activeDeviceName(), `${state.selectedPreset}  T${state.selectedTrack + 1}  Pg ${state.page + 1}/${pageCount()}`);
  visibleParams().forEach((param, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const cellX = 8 + col * 60;
    const cellY = 50 + row * 35;
    const cellW = 56;
    const value = format(param);
    const fill = Math.round(norm(param) * (cellW - 6));
    if (touched?.key === param.key && touched?.componentId === param.componentId) {
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

function componentIndicator(slot) {
  const settings = settingsComponent();
  if (slot.kind === "settings" || state.context === "master") return "";
  const hits = settings.lfos
    .map((lfo, i) => lfo.enabled && lfo.targetComponent === slot.id ? `~${i + 1}` : "")
    .filter(Boolean);
  return hits.join("+");
}

function drawChainScreen() {
  const title = state.context === "master" ? "Master FX" : `Track ${state.selectedTrack + 1} Chain`;
  drawHeader(title, state.context === "master" ? "Long Note/Session equivalent" : "Long Track/Menu equivalent");
  currentChain().forEach((slot, i) => {
    const y = 55 + i * 14;
    const selected = i === state.selectedSlot;
    if (selected) {
      ctx.fillStyle = "#151713";
      ctx.fillRect(8, y - 10, 240, 13);
      ctx.fillStyle = "#d8ddd0";
    }
    const status = slot.kind === "settings" ? "   " : slot.enabled ? "ON " : "B  ";
    const indicator = componentIndicator(slot);
    ctx.fillText(`${i + 1} ${slot.type.padEnd(10).slice(0, 10)} ${status}${slot.name}`.slice(0, 31), 12, y);
    if (indicator) ctx.fillText(indicator, 220, y);
    ctx.fillStyle = "#151713";
  });
  ctx.fillText("Jog: select  Mute+Jog: bypass", 12, 120);
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
    if (i === 0) {
      ctx.fillStyle = "#151713";
      ctx.fillRect(8, y - 10, 240, 12);
      ctx.fillStyle = "#d8ddd0";
    }
    ctx.fillText(presets[idx].name, 12, y);
    ctx.fillStyle = "#151713";
  });
  ctx.fillText(`Loaded: ${state.selectedPreset}`.slice(0, 30), 12, 120);
}

function selectChainPosition(index, context = state.context) {
  state.context = context;
  state.selectedSlot = clamp(index, 0, currentChain().length - 1);
  state.mode = "chain";
  state.page = 0;
  state.touchedParam = null;
  syncAudioChain();
}

function renderTracks() {
  tracksEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `track ${i === state.selectedTrack && state.context === "slot" ? "selected" : ""}`;
    button.textContent = `Track ${i + 1}`;
    button.addEventListener("click", () => {
      state.selectedTrack = i;
      state.context = "slot";
      state.mode = "chain";
      state.selectedSlot = 1;
      state.page = 0;
      syncAudioChain();
      update();
    });
    tracksEl.appendChild(button);
  }
}

function renderChain() {
  chainEl.innerHTML = "";
  currentChain().forEach((slot, i) => {
    const button = document.createElement("button");
    button.type = "button";
    const bypass = slot.kind !== "settings" && !slot.enabled ? "disabled" : "";
    button.className = `chain-slot ${i === state.selectedSlot ? "selected" : ""} ${bypass}`;
    const marker = componentIndicator(slot);
    const status = slot.kind === "settings" ? "open" : slot.enabled ? "enabled" : "bypassed";
    button.innerHTML = `<span>${slot.type}${marker ? ` ${marker}` : ""}</span><b>${slot.name}</b><small>${status}${!slot.enabled && slot.kind !== "settings" ? " B" : ""}</small>`;
    button.addEventListener("click", () => {
      selectChainPosition(i);
      update();
    });
    button.addEventListener("dblclick", () => {
      toggleSelectedBypass(slot);
      update();
    });
    chainEl.appendChild(button);
  });
}

function toggleSelectedBypass(slot = selectedSlot()) {
  if (!slot || slot.kind === "settings") return;
  slot.enabled = !slot.enabled;
  syncAudioChain();
}

function chainToggleHtml(slot) {
  if (slot.kind === "settings") return "";
  return `<button class="chain-toggle ${slot.enabled ? "selected" : ""}" type="button" data-chain-toggle>${slot.enabled ? "Enabled" : "Bypassed"}</button>`;
}

function renderChainInspector() {
  const slot = selectedSlot();
  if (!slot) {
    chainInspectorEl.innerHTML = "";
    return;
  }
  const bypassNote = !slot.enabled && slot.kind !== "settings"
    ? `<p class="bypass-note">Bypassed: ${slot.kind === "midi_fx" ? "MIDI passes through unchanged." : slot.kind === "sound_generator" ? "Synth is silent; downstream FX tails can continue." : "Audio passes through dry."}</p>`
    : "";

  if (slot.kind === "midi_fx") {
    chainInspectorEl.innerHTML = `
      <div class="chain-inspector-head"><b>${slot.name}</b>${chainToggleHtml(slot)}</div>
      ${bypassNote}
      <div class="mini-controls">
        <label>Transpose <input data-param="transpose" type="range" min="-24" max="24" step="1" value="${slot.params.transpose}"><span>${slot.params.transpose}</span></label>
        <label>Chance <input data-param="chance" type="range" min="0" max="1" step="0.01" value="${slot.params.chance}"><span>${slot.params.chance.toFixed(2)}</span></label>
        <label>Velocity <input data-param="velocity" type="range" min="0.1" max="1.5" step="0.01" value="${slot.params.velocity}"><span>${slot.params.velocity.toFixed(2)}</span></label>
        <label class="check-row"><input data-scale-lock type="checkbox" ${slot.scaleLock ? "checked" : ""}> Scale lock</label>
      </div>`;
    chainInspectorEl.querySelectorAll("[data-param]").forEach((input) => {
      input.addEventListener("input", () => {
        slot.params[input.dataset.param] = Number(input.value);
        update();
      });
    });
    chainInspectorEl.querySelector("[data-scale-lock]").addEventListener("input", (event) => {
      slot.scaleLock = event.target.checked;
      update();
    });
  } else if (slot.kind === "audio_fx") {
    chainInspectorEl.innerHTML = `
      <div class="chain-inspector-head"><b>${slot.name}</b>${chainToggleHtml(slot)}</div>
      ${bypassNote}
      <div class="mini-controls">
        <label>Drive <input data-param="drive" type="range" min="0" max="1" step="0.01" value="${slot.params.drive}"><span>${slot.params.drive.toFixed(2)}</span></label>
        <label>Tone <input data-param="tone" type="range" min="0" max="1" step="0.01" value="${slot.params.tone}"><span>${slot.params.tone.toFixed(2)}</span></label>
        <label>Wet <input data-param="wet" type="range" min="0" max="1" step="0.01" value="${slot.params.wet}"><span>${slot.params.wet.toFixed(2)}</span></label>
      </div>`;
    chainInspectorEl.querySelectorAll("[data-param]").forEach((input) => {
      input.addEventListener("input", () => {
        slot.params[input.dataset.param] = Number(input.value);
        syncAudioChain();
        update();
      });
    });
  } else if (slot.kind === "settings") {
    const paramsHtml = settingsParamDefs.map((def) => {
      const value = slot.params[def.key];
      return `<label>${def.label} <input data-setting="${def.key}" type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}"><span>${format({ ...def, value })}</span></label>`;
    }).join("");
    chainInspectorEl.innerHTML = `
      <div class="chain-inspector-head"><b>Slot Settings</b><span>knobs, routing, LFOs</span></div>
      <div class="mini-controls">${paramsHtml}</div>
      <p class="bypass-note">Forward: Auto, Thru, then Ch 1-16. MIDI Out: Schw or Both.</p>`;
    chainInspectorEl.querySelectorAll("[data-setting]").forEach((input) => {
      input.addEventListener("input", () => {
        slot.params[input.dataset.setting] = Number(input.value);
        slot.lfos[0].enabled = slot.params.lfo1_depth > 0;
        slot.lfos[0].depth = slot.params.lfo1_depth;
        slot.lfos[1].enabled = slot.params.lfo2_depth > 0;
        slot.lfos[1].depth = slot.params.lfo2_depth;
        syncAudioChain();
        update();
      });
    });
  } else {
    chainInspectorEl.innerHTML = `<div class="chain-inspector-head"><b>${activeModuleName}</b>${chainToggleHtml(slot)}</div>${bypassNote}<p class="bypass-note">Shared C DSP core via WASM.</p>`;
  }
  const toggle = chainInspectorEl.querySelector("[data-chain-toggle]");
  if (toggle) {
    toggle.addEventListener("click", () => {
      toggleSelectedBypass(slot);
      update();
    });
  }
}

function renderKnobs() {
  knobsEl.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const param = visibleParams()[i];
    const el = document.createElement("button");
    el.type = "button";
    el.className = `knob ${selectedScopedSlotIsBypassed() ? "bypassed" : ""}`;
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
  const bypassed = selectedScopedSlotIsBypassed();
  activeParams().forEach((param) => {
    const control = document.createElement("label");
    control.className = `control ${bypassed ? "bypassed" : ""}`;
    control.innerHTML = `
      <div class="control-head">
        <b>${param.label}</b>
        <span>${format(param)}</span>
      </div>
      <input type="range" min="${param.min}" max="${param.max}" step="${param.step || 0.01}" value="${param.value}">
      ${bypassed ? "<small>Bypassed</small>" : ""}`;
    control.querySelector("input").addEventListener("input", (event) => {
      setParamValue(param, Number(event.target.value), true);
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
    audioEl.src = `../renders/${moduleId}-suite/${file}`;
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
      const velocity = event.pressure && event.pressure > 0 ? clamp(event.pressure, 0.25, 1) : 0.94;
      state.activePads.set(i, { note, velocity, aftertouch: velocity });
      state.steps[state.selectedStep].note = note;
      noteOn(note, velocity);
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
  statusEl.textContent = `${state.context === "master" ? "Master " : ""}${state.mode[0].toUpperCase()}${state.mode.slice(1)}${state.shift ? " + Shift" : ""}`;
  panelTitleEl.textContent = `${activeDeviceName()} Parameters`;
  document.querySelectorAll(".mode-key").forEach((button) => {
    button.classList.toggle("selected", button.dataset.mode === state.mode);
  });
  document.getElementById("shiftKey").classList.toggle("selected", state.shift);
  document.getElementById("recordKey").classList.toggle("selected", state.record);
  document.getElementById("playKey").classList.toggle("selected", state.playing);
  document.getElementById("loopKey").classList.toggle("selected", state.loop);
  document.getElementById("muteKey").classList.toggle("selected", state.mute);
  document.getElementById("noteSessionKey").classList.toggle("selected", state.context === "master");
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
  audioEngine.send(message);
}

function sendParam(param) {
  if (param.scope) return;
  if (!selectedSlot()?.enabled && state.mode === "chain") return;
  send({ type: "param", key: param.key, id: paramIds[param.key], value: param.value });
}

function midiFxSlot() {
  return state.tracks[state.selectedTrack].chain.find((slot) => slot.kind === "midi_fx");
}

function soundSlot() {
  return state.tracks[state.selectedTrack].chain.find((slot) => slot.kind === "sound_generator");
}

function audioFxSlots() {
  return state.tracks[state.selectedTrack].chain.filter((slot) => slot.kind === "audio_fx");
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
  if (Math.random() > slot.params.chance) return null;
  let processedNote = clamp(note + slot.params.transpose, 0, 127);
  if (slot.scaleLock) processedNote = nearestScaleNote(processedNote);
  const settings = settingsComponent();
  if (settings?.params.midi_fx_output >= 0.5) {
    state.tracks[state.selectedTrack].moveEchoEvents.push({ note: processedNote, velocity, at: performance.now() });
  }
  return {
    note: processedNote,
    velocity: clamp(velocity * slot.params.velocity, 0, 1)
  };
}

function audioFxPayload() {
  const slotFx = audioFxSlots().map((slot) => ({
    id: slot.id,
    enabled: slot.enabled,
    ...slot.params
  }));
  const masterFx = state.master.chain.map((slot) => ({
    id: slot.id,
    enabled: slot.enabled,
    ...slot.params
  }));
  return { type: "audioFxChain", slotFx, masterFx };
}

function syncAudioChain() {
  send(audioFxPayload());
  send({ type: "soundBypass", bypassed: !soundSlot()?.enabled });
}

function setParamValue(param, value, markCustom = false) {
  const nextValue = clamp(value, param.min, param.max);
  param.value = nextValue;
  const component = param.componentId ? currentChain().find((slot) => slot.id === param.componentId) : null;
  if (param.scope === "component" && component) {
    component.params[param.key] = nextValue;
    syncAudioChain();
    update();
    return;
  }
  if (param.scope === "settings") {
    const settings = settingsComponent();
    settings.params[param.key] = nextValue;
    settings.lfos[0].enabled = settings.params.lfo1_depth > 0;
    settings.lfos[0].depth = settings.params.lfo1_depth;
    settings.lfos[1].enabled = settings.params.lfo2_depth > 0;
    settings.lfos[1].depth = settings.params.lfo2_depth;
    syncAudioChain();
    update();
    return;
  }
  if (markCustom) state.selectedPreset = "Custom";
  if (state.record && state.mode === "seq") {
    state.steps[state.selectedStep].locks[param.key] = nextValue;
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
  showError("");
  audioToggle.textContent = "Loading WASM...";
  await audioEngine.enable({
    moduleId,
    processorName: workletProcessor,
    workletUrl,
    onReady: () => {
      audioToggle.textContent = "WASM Audio On";
      params.forEach(sendParam);
      syncAudioChain();
    },
    onError: (message) => {
      audioToggle.textContent = "Audio failed";
      showError(message);
    }
  });
}

function noteOn(note, velocity = 0.94) {
  enableAudio().then(() => {
    const processed = processMidiFx(note, velocity);
    if (!processed) return;
    const track = state.tracks[state.selectedTrack];
    track.activeNotes.set(note, processed.note);
    send({ type: "noteOn", note: processed.note, velocity: processed.velocity });
  }).catch((error) => {
    audioToggle.textContent = "Audio failed";
    showError(error.message);
  });
}

function noteOff(note) {
  const track = state.tracks[state.selectedTrack];
  const processedNote = track.activeNotes.get(note) ?? note;
  track.activeNotes.delete(note);
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
    state.selectedSlot = clamp(state.selectedSlot + direction, 0, currentChain().length - 1);
    state.page = 0;
  } else if (state.mode === "seq") {
    state.selectedStep = clamp(state.selectedStep + direction, 0, 15);
  } else if (state.mode === "browser" && presets.length) {
    state.browserIndex = (state.browserIndex + direction + presets.length) % presets.length;
  }
  syncAudioChain();
  update();
}

function pressWheel() {
  if (state.mode === "chain") {
    if (state.mute) toggleSelectedBypass();
    else state.mode = "device";
  } else if (state.mode === "seq") {
    const step = state.steps[state.selectedStep];
    step.enabled = !step.enabled;
  } else if (state.mode === "browser") {
    applyPreset(presets[state.browserIndex]?.name);
    state.mode = "device";
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
    if (state.mode === "browser") state.mode = "device";
    else if (state.mode === "device") state.mode = "chain";
    else state.mode = "device";
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
  document.getElementById("noteSessionKey").addEventListener("click", () => {
    state.context = state.context === "master" ? "slot" : "master";
    state.mode = "chain";
    state.selectedSlot = 0;
    state.page = 0;
    syncAudioChain();
    update();
  });
  document.getElementById("clearSteps").addEventListener("click", () => {
    state.steps = Array.from({ length: 16 }, () => ({ enabled: false, note: 60, velocity: 0.9, locks: {} }));
    update();
  });
  document.querySelectorAll(".mode-key").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.mode === "chain") state.context = "slot";
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
  moduleSelectEl?.addEventListener("change", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("module", moduleSelectEl.value);
    window.location.href = url.toString();
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
  if (event.key === "m" && event.shiftKey) {
    state.context = "master";
    state.mode = "chain";
    state.selectedSlot = 0;
    update();
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    return setPlaying(!state.playing);
  }
  const padIndex = keyMap[event.key];
  if (padIndex !== undefined) {
    const note = noteForPad(padIndex);
    state.activePads.set(padIndex, { note, velocity: 0.94, aftertouch: 0.94 });
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
await loadModuleIndex();
try {
  await loadMetadata();
} catch (error) {
  showError(`Failed to load module metadata for ${moduleId}: ${error.message}`);
}
update();

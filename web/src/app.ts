// @ts-nocheck
import { AudioEngine } from "./audio-engine.js";
import {
  audioFxParamDefs,
  makeInitialState,
  midiFxParamDefs,
  scales,
  settingsParamDefs
} from "./chain-state.js";
import { loadModuleIndex as fetchModuleIndex, loadModuleMetadata } from "./module-metadata.js";

let moduleId = "westfold";
const workletUrl = new URLSearchParams(window.location.search).get("worklet") || "/web/module-worklet.js";
const workletProcessor = new URLSearchParams(window.location.search).get("processor") || "module-processor";
let activeModuleName = moduleId.replace(/(^|-)([a-z])/g, (_match, _dash, letter) => letter.toUpperCase());

const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const screen = document.getElementById("screen");
const ctx = screen.getContext("2d");
const knobsEl = document.getElementById("knobs");
const controlsEl = document.getElementById("controls");
const padsEl = document.getElementById("pads");
const stepsEl = document.getElementById("steps");
const statusEl = document.getElementById("status");
const panelTitleEl = document.getElementById("panelTitle");
const panelSubtitleEl = document.getElementById("panelSubtitle");
const presetEl = document.getElementById("presets");
const errorEl = document.getElementById("errors");
const previewEl = document.getElementById("previewList");
const previewsPanelEl = document.getElementById("previewsPanel");
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
const sequencerPanelEl = document.getElementById("sequencerPanel");

let params = [];
let paramIds = {};
let presets = [];
let moduleIndex = []; // [{ id, name?, kind? }, ...] — populated by loadModuleIndex
const audioEngine = new AudioEngine();
let midiAccess = null;
let seqTimer = null;

window.addEventListener("moveforge:wasm-rebuilt", (event) => {
  const detail = event.detail;
  if (!audioEngine.ready) return;
  const rebuiltModuleId = detail?.moduleId;
  if (!rebuiltModuleId) {
    audioEngine.reloadAll().catch((error) => console.error("[dev-reload] wasm reload failed", error));
    return;
  }
  // Reload every slot currently hosting the rebuilt module.
  const track = state.tracks[state.selectedTrack];
  const matchingSlots = track.chain
    .filter((slot) => slot.moduleId === rebuiltModuleId)
    .map((slot) => slot.id);
  if (matchingSlots.length === 0) return;
  Promise.all(matchingSlots.map((id) => audioEngine.reloadSlot(id)))
    .catch((error) => console.error("[dev-reload] wasm reload failed", error));
});

const state = makeInitialState(moduleId, activeModuleName);

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
      sound.moduleId = moduleJson.id || moduleId;
      sound.name = activeModuleName;
    }
    // LFO target stays anchored to the positional sound slot id, not the moduleId.
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

async function selectModule(nextModuleId) {
  if (!nextModuleId || nextModuleId === moduleId) return;
  send({ type: "allNotesOff" });
  for (const track of state.tracks) track.activeNotes.clear();
  state.activePads.clear();
  moduleId = nextModuleId;
  activeModuleName = moduleId.replace(/(^|-)([a-z])/g, (_match, _dash, letter) => letter.toUpperCase());
  state.page = 0;
  state.mode = "device";
  state.touchedParam = null;
  await loadMetadata();
  if (audioEngine.ready) await enableAudio();
  update();
}

async function loadModuleIndex() {
  if (!moduleSelectEl) return;
  try {
    const index = await fetchModuleIndex();
    moduleIndex = index.modules || [];
    moduleSelectEl.innerHTML = "";
    // Top-level dropdown drives the sound_generator slot only.
    // midi_fx / audio_fx slots get their own pickers in the chain inspector.
    for (const item of moduleIndex) {
      if (item.kind && item.kind !== "sound_generator") continue;
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

function chainPickerHtml(slot) {
  if (slot.kind !== "midi_fx" && slot.kind !== "audio_fx") return "";
  const options = moduleIndex.filter((item) => (item.kind || "sound_generator") === slot.kind);
  if (options.length === 0) {
    return `<div class="chain-picker"><label>Module</label><span class="chain-picker-empty">No ${slot.kind === "midi_fx" ? "MIDI FX" : "Audio FX"} modules installed</span></div>`;
  }
  const optionsHtml = [`<option value="">— Empty —</option>`]
    .concat(options.map((item) => `<option value="${item.id}"${item.id === slot.moduleId ? " selected" : ""}>${item.name || item.id}</option>`))
    .join("");
  return `<div class="chain-picker"><label for="chain-picker-${slot.id}">Module</label><select id="chain-picker-${slot.id}" data-chain-picker>${optionsHtml}</select></div>`;
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
  const detail = slot.kind === "settings"
    ? "Knobs, routing, and LFO state for this track."
    : slot.kind === "sound_generator"
      ? "Shared C DSP core via WASM."
      : slot.kind === "midi_fx"
        ? "Transforms notes before the sound generator."
        : "Processes audio after the sound generator.";
  const status = slot.kind === "settings" ? "Open" : slot.enabled ? "Enabled" : "Bypassed";

  chainInspectorEl.innerHTML = `
    <div class="chain-inspector-head">
      <div>
        <span>${state.context === "master" ? "Master" : `Track ${state.selectedTrack + 1}`} / ${slot.type}</span>
        <b>${slot.name}</b>
      </div>
      ${chainToggleHtml(slot)}
    </div>
    <div class="chain-inspector-meta">
      <span>${status}</span>
      <span>${detail}</span>
    </div>
    ${chainPickerHtml(slot)}
    ${bypassNote}`;
  const toggle = chainInspectorEl.querySelector("[data-chain-toggle]");
  if (toggle) {
    toggle.addEventListener("click", () => {
      toggleSelectedBypass(slot);
      update();
    });
  }
  const picker = chainInspectorEl.querySelector("[data-chain-picker]");
  if (picker) {
    picker.addEventListener("change", (event) => {
      const nextModuleId = event.target.value || null;
      handleSlotModuleChange(slot, nextModuleId);
    });
  }
}

function handleSlotModuleChange(slot, nextModuleId) {
  if (slot.moduleId === nextModuleId) return;
  slot.moduleId = nextModuleId;
  if (nextModuleId) {
    const entry = moduleIndex.find((item) => item.id === nextModuleId);
    slot.name = entry?.name || nextModuleId;
    slot.enabled = true;
  } else {
    slot.name = "Empty";
    slot.enabled = false;
  }
  syncChainToEngine().catch((error) => {
    document.body.dataset.audio = "failed";
    showError(error.message || String(error));
  });
  update();
}

function buildChainSpec() {
  const track = state.tracks[state.selectedTrack];
  const spec = [];
  for (const slot of track.chain) {
    if (slot.kind === "settings") continue;
    if (!slot.moduleId) continue;
    if (!slot.enabled && slot.kind === "audio_fx") continue;
    spec.push({ slotId: slot.id, moduleId: slot.moduleId, kind: slot.kind });
  }
  return spec;
}

function buildEngineConfig() {
  return {
    workletUrl,
    processorName: workletProcessor,
    onError: (_slotId, message) => {
      document.body.dataset.audio = "failed";
      showError(message);
    },
    onSlotReady: (slotId) => {
      if (slotId === "sound") {
        document.body.dataset.audio = "ready";
        params.forEach(sendParam);
        syncAudioChain();
      }
    },
    onMidiOut: (event) => {
      // Relay MIDI emitted by a midi_fx worklet onward to the sound_gen slot.
      // Only midi_fx slots emit midiOut; if a future module emits too, it
      // would also flow here — we keep the routing scoped to the midi_fx slot.
      const slot = midiFxSlot();
      if (!slot || event.slotId !== slot.id) return;
      if (!audioEngine.hasSlot("sound")) return;
      const type = event.status & 0xF0;
      if (type === 0x90 && event.d2 > 0) {
        audioEngine.sendToSlot("sound", {
          type: "noteOn",
          note: event.d1,
          velocity: event.d2 / 127
        });
      } else if (type === 0x80 || (type === 0x90 && event.d2 === 0)) {
        audioEngine.sendToSlot("sound", { type: "noteOff", note: event.d1 });
      } else {
        audioEngine.sendToSlot("sound", {
          type: "midiIn",
          status: event.status,
          d1: event.d1,
          d2: event.d2
        });
      }
    }
  };
}

async function syncChainToEngine() {
  if (!audioEngine.hasSlot("sound")) return; // not enabled yet; first enableAudio will pick up state
  await audioEngine.enableChain(buildChainSpec(), buildEngineConfig());
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
  const slot = selectedSlot();
  const showPresets = state.mode !== "chain" || slot?.kind === "sound_generator";
  presetEl.hidden = !showPresets;
  if (!showPresets) return;
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
    audioEl.src = `/renders/${moduleId}-suite/${file}`;
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
  const slot = selectedSlot();
  panelTitleEl.textContent = state.mode === "chain" ? "Chain" : `${activeDeviceName()} Parameters`;
  if (panelSubtitleEl) {
    panelSubtitleEl.textContent = state.mode === "chain" && slot
      ? `${state.context === "master" ? "Master" : `Track ${state.selectedTrack + 1}`} / ${slot.name}`
      : `${activeModuleName} / ${state.selectedPreset}`;
  }
  if (sequencerPanelEl) sequencerPanelEl.hidden = state.mode !== "seq";
  if (previewsPanelEl) previewsPanelEl.hidden = state.mode === "chain";
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

function syncAudioChain() {
  // Sound bypass is handled inside the sound_gen worklet (silences its output
  // while leaving downstream FX tails alive). For midi_fx / audio_fx slots,
  // bypass = removed from the engine chain entirely, which is what
  // syncChainToEngine derives from buildChainSpec().
  send({ type: "soundBypass", bypassed: !soundSlot()?.enabled });
  syncChainToEngine().catch((error) => {
    document.body.dataset.audio = "failed";
    showError(error.message || String(error));
  });
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
  document.body.dataset.audio = "starting";
  await audioEngine.enableChain(buildChainSpec(), buildEngineConfig());
}

function activeMidiFxSlotId() {
  const slot = midiFxSlot();
  if (!slot?.moduleId) return null;
  return audioEngine.hasSlot(slot.id) ? slot.id : null;
}

function noteOn(note, velocity = 0.94) {
  enableAudio().then(() => {
    if (!midiAccess) void enableMidi(true);
    const midiFxId = activeMidiFxSlotId();
    if (midiFxId) {
      // Real midi_fx module: route through the worklet. The sound slot is
      // fed by onMidiOut as the WASM emits transformed messages.
      audioEngine.sendToSlot(midiFxId, {
        type: "midiIn",
        status: 0x90,
        d1: clamp(Math.round(note), 0, 127),
        d2: clamp(Math.round(velocity * 127), 1, 127)
      });
      return;
    }
    // Legacy client-side midi_fx shim (mock chain-state midi_fx slot).
    const processed = processMidiFx(note, velocity);
    if (!processed) return;
    const track = state.tracks[state.selectedTrack];
    track.activeNotes.set(note, processed.note);
    send({ type: "noteOn", note: processed.note, velocity: processed.velocity });
  }).catch((error) => {
    document.body.dataset.audio = "failed";
    showError(error.message);
  });
}

function noteOff(note) {
  const midiFxId = activeMidiFxSlotId();
  if (midiFxId) {
    audioEngine.sendToSlot(midiFxId, {
      type: "midiIn",
      status: 0x80,
      d1: clamp(Math.round(note), 0, 127),
      d2: 0
    });
    return;
  }
  const track = state.tracks[state.selectedTrack];
  const processedNote = track.activeNotes.get(note) ?? note;
  track.activeNotes.delete(note);
  send({ type: "noteOff", note: processedNote });
}

async function enableMidi(silent = false) {
  if (!navigator.requestMIDIAccess) {
    if (!silent) showError("Web MIDI is not available in this browser.");
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
    selectModule(moduleSelectEl.value).catch((error) => {
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

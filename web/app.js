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

const screen = document.getElementById("screen");
const ctx = screen.getContext("2d");
const knobsEl = document.getElementById("knobs");
const controlsEl = document.getElementById("controls");
const padsEl = document.getElementById("pads");
const statusEl = document.getElementById("status");
const presetEl = document.getElementById("presets");
const audioToggle = document.getElementById("audioToggle");
const errorEl = document.getElementById("errors");
const previewEl = document.getElementById("previewList");
let params = [];
let presets = [];
let page = 0;
let selectedPreset = "Init";
let audio = null;
let node = null;
let audioReady = false;
let midiAccess = null;

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
    .map((item) => ({
      ...item,
      value: item.default
    }));
}

async function loadMetadata() {
  try {
    const [moduleJson, presetJson] = await Promise.all([
      loadJson("../src/module.json"),
      loadJson("../src/presets.json")
    ]);
    params = paramDefaultsFromModule(moduleJson);
    presets = presetJson.presets || fallbackPresets;
    selectedPreset = presets[0]?.name || "Init";
    applyPreset(selectedPreset, false);
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

function format(param) {
  if (param.key === "bend_range") return Number(param.value).toFixed(1);
  if (param.max > 3) return Number(param.value).toFixed(2);
  return Number(param.value).toFixed(2);
}

function drawScreen() {
  ctx.fillStyle = "#d8ddd0";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#151713";
  ctx.font = "16px Menlo, monospace";
  ctx.fillText("Westfold", 10, 21);
  ctx.font = "11px Menlo, monospace";
  ctx.fillText(`Preset ${selectedPreset}`, 10, 39);
  ctx.fillRect(10, 46, 236, 1);

  const visible = params.slice(page * 4, page * 4 + 4);
  visible.forEach((param, i) => {
    const y = 63 + i * 15;
    const fill = Math.round(norm(param) * 82);
    ctx.fillText(param.label.padEnd(8).slice(0, 8), 10, y);
    ctx.strokeRect(94, y - 9, 86, 8);
    ctx.fillRect(96, y - 7, fill, 4);
    ctx.fillText(format(param).padStart(5), 190, y);
  });

  ctx.fillText(`Page ${page + 1}/${pageCount()}`, 190, 121);
}

function pageCount() {
  return Math.max(1, Math.ceil(params.length / 4));
}

function renderKnobs() {
  knobsEl.innerHTML = "";
  const visible = params.slice(page * 4, page * 4 + 4);
  visible.forEach((param) => {
    const el = document.createElement("div");
    el.className = "knob";
    const angle = 270 * norm(param);
    el.innerHTML = `<div class="dial" style="--angle:${angle}deg"></div><span>${param.label}</span>`;
    knobsEl.appendChild(el);
  });
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
      param.value = Number(input.value);
      selectedPreset = "Custom";
      sendParam(param);
      update();
    });
    controlsEl.appendChild(control);
  });
}

function applyPreset(name, shouldUpdate = true) {
  const preset = presets.find((p) => p.name === name);
  if (!preset) return;
  selectedPreset = name;
  Object.entries(preset.params || {}).forEach(([key, value]) => {
    const param = params.find((p) => p.key === key);
    if (param) {
      param.value = value;
      sendParam(param);
    }
  });
  if (shouldUpdate) update();
}

function renderPresets() {
  presetEl.innerHTML = "";
  presets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.name;
    button.className = preset.name === selectedPreset ? "selected" : "";
    button.addEventListener("click", () => applyPreset(preset.name));
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

function renderPads() {
  padsEl.innerHTML = "";
  const notes = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74];
  for (let i = 0; i < 32; i++) {
    const pad = document.createElement("div");
    pad.className = i < notes.length ? "pad playable" : "pad";
    if (i < notes.length) {
      const note = notes[i];
      pad.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        noteOn(note, 0.94);
        pad.classList.add("active");
      });
      pad.addEventListener("pointerup", () => {
        noteOff(note);
        pad.classList.remove("active");
      });
      pad.addEventListener("pointerleave", () => {
        noteOff(note);
        pad.classList.remove("active");
      });
    }
    padsEl.appendChild(pad);
  }
}

function update() {
  statusEl.textContent = `Page ${page + 1}`;
  drawScreen();
  renderKnobs();
  renderControls();
  renderPresets();
}

function send(message) {
  if (node) node.port.postMessage(message);
}

function sendParam(param) {
  send({ type: "param", key: param.key, value: param.value });
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
    } else if (event.data?.type === "error") {
      audioToggle.textContent = "Audio failed";
      showError(event.data.message);
    }
  };
}

function noteOn(note, velocity = 0.94) {
  enableAudio().then(() => {
    send({ type: "noteOn", note, velocity });
  }).catch((error) => {
    audioToggle.textContent = "Audio failed";
    showError(error.message);
  });
}

function noteOff(note) {
  send({ type: "noteOff", note });
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
    const param = params[index];
    if (param) {
      param.value = param.min + (d2 / 127) * (param.max - param.min);
      selectedPreset = "Custom";
      sendParam(param);
      update();
    }
  } else if (type === 0xE0) {
    const bend = (((d2 << 7) | d1) - 8192) / 8192;
    send({ type: "pitchBend", value: bend });
  }
}

document.getElementById("prevPage").addEventListener("click", () => {
  page = Math.max(0, page - 1);
  update();
});

document.getElementById("nextPage").addEventListener("click", () => {
  page = Math.min(pageCount() - 1, page + 1);
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

const keyMap = {
  a: 48, w: 50, s: 52, d: 53, r: 55, f: 57, t: 59, g: 60,
  h: 62, u: 64, j: 65, i: 67, k: 69, o: 71, l: 72
};

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  const note = keyMap[event.key];
  if (note !== undefined) noteOn(note);
});

window.addEventListener("keyup", (event) => {
  const note = keyMap[event.key];
  if (note !== undefined) noteOff(note);
});

renderPads();
await loadMetadata();
update();

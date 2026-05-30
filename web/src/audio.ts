import { AudioEngine, type AudioEngineConfig, type ChainSlotSpec } from "./audio-engine";
import { useStore } from "./store";

const params = new URLSearchParams(window.location.search);
const workletUrl = params.get("worklet") ?? "/module-worklet.js";
const workletProcessor = params.get("processor") ?? "module-processor";

const engine = new AudioEngine();
let booted = false;

function buildSpec(): ChainSlotSpec[] {
  const state = useStore.getState();
  const chain = state.tracks[state.selectedTrack].chain;
  const spec: ChainSlotSpec[] = [];
  for (const slot of chain) {
    if (slot.kind === "settings") continue;
    if (!slot.moduleId) continue;
    if (!slot.enabled && (slot.kind === "midi_fx" || slot.kind === "audio_fx")) continue;
    spec.push({ slotId: slot.id, moduleId: slot.moduleId, kind: slot.kind });
  }
  return spec;
}

function buildConfig(): AudioEngineConfig {
  return {
    workletUrl,
    processorName: workletProcessor,
    onError: (_slotId, message) => useStore.setState({ error: message }),
    onSlotReady: (slotId) => {
      seedParamsForSlot(slotId);
    },
    onMidiOut: (event) => {
      // midi_fx slot emitted a MIDI message; forward to sound generator.
      if (!engine.hasSlot("sound")) return;
      const type = event.status & 0xf0;
      if (type === 0x90 && event.d2 > 0) {
        engine.sendToSlot("sound", { type: "noteOn", note: event.d1, velocity: event.d2 / 127 });
      } else if (type === 0x80 || (type === 0x90 && event.d2 === 0)) {
        engine.sendToSlot("sound", { type: "noteOff", note: event.d1 });
      } else {
        engine.sendToSlot("sound", { type: "midiIn", status: event.status, d1: event.d1, d2: event.d2 });
      }
    }
  };
}

function seedParamsForSlot(slotId: string): void {
  const state = useStore.getState();
  if (slotId === "sound") {
    for (const p of state.topLevelParams) {
      engine.sendToSlot("sound", { type: "param", key: p.key, id: p.id, value: p.value });
    }
    return;
  }
  const slot = state.tracks[state.selectedTrack].chain.find((s) => s.id === slotId);
  if (!slot || slot.kind === "sound_generator" || slot.kind === "settings") return;
  const meta = state.slotMeta[`${state.selectedTrack}:${slot.id}`];
  if (!meta) return;
  for (const p of meta.params) {
    const value = (slot.params as Record<string, number>)[p.key] ?? p.default;
    engine.sendToSlot(slotId, { type: "param", key: p.key, id: p.id, value });
  }
}

async function ensureBooted(): Promise<void> {
  if (booted) return;
  await engine.enableChain(buildSpec(), buildConfig());
  engine.setMasterVolume(useStore.getState().masterVolume);
  booted = true;
}

export async function syncChain(): Promise<void> {
  if (!booted) return;
  engine.sendToAll({ type: "allNotesOff" });
  await engine.enableChain(buildSpec(), buildConfig());
}

function activeMidiFxSlotId(): string | null {
  const state = useStore.getState();
  const slot = state.tracks[state.selectedTrack].chain.find((s) => s.kind === "midi_fx");
  if (!slot || !slot.moduleId || !slot.enabled) return null;
  return engine.hasSlot(slot.id) ? slot.id : null;
}

const clampMidi = (n: number) => Math.max(0, Math.min(127, Math.round(n)));

export async function noteOn(note: number, velocity = 0.94): Promise<void> {
  await ensureBooted();
  const midiFx = activeMidiFxSlotId();
  if (midiFx) {
    engine.sendToSlot(midiFx, {
      type: "midiIn",
      status: 0x90,
      d1: clampMidi(note),
      d2: Math.max(1, Math.min(127, Math.round(velocity * 127)))
    });
    return;
  }
  if (engine.hasSlot("sound")) {
    engine.sendToSlot("sound", { type: "noteOn", note, velocity });
  }
}

export function noteOff(note: number): void {
  const midiFx = activeMidiFxSlotId();
  if (midiFx) {
    engine.sendToSlot(midiFx, { type: "midiIn", status: 0x80, d1: clampMidi(note), d2: 0 });
    return;
  }
  if (engine.hasSlot("sound")) {
    engine.sendToSlot("sound", { type: "noteOff", note });
  }
}

export function allNotesOff(): void {
  if (engine.hasSlot("sound")) {
    engine.sendToSlot("sound", { type: "allNotesOff" });
  }
}

export function hardPanic(): void {
  engine.sendToAll({ type: "allNotesOff" });
  engine.resetAll();
}

export function setMasterVolume(volume: number): void {
  engine.setMasterVolume(volume);
}

export function sendParamToSlot(slotId: string, key: string, id: number, value: number): void {
  if (!engine.hasSlot(slotId)) return;
  engine.sendToSlot(slotId, { type: "param", key, id, value });
}

export async function reloadModuleWasm(moduleId: string | null): Promise<void> {
  // moduleId === null means a shared host header changed; reload every loaded slot.
  const state = useStore.getState();
  for (const track of state.tracks) {
    for (const slot of track.chain) {
      if (slot.kind === "settings") continue;
      if (moduleId !== null && slot.moduleId !== moduleId) continue;
      if (engine.hasSlot(slot.id)) await engine.reloadSlot(slot.id);
    }
  }
}

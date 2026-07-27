import { AudioEngine, type AudioEngineConfig, type ChainSlotSpec } from "./audio-engine";
import { useStore } from "./store";

export type HostParamUpdate = {
  slotId: string;
  key: string;
  id: number;
  value: number;
};

const params = new URLSearchParams(window.location.search);
const workletUrl = params.get("worklet") ?? `${import.meta.env.BASE_URL}module-worklet.js`;
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

export function sendParamUpdate(update: HostParamUpdate): void {
  if (!engine.hasSlot(update.slotId)) return;
  engine.sendToSlot(update.slotId, {
    type: "param",
    key: update.key,
    id: update.id,
    value: update.value
  });
}

export function sendParamUpdates(updates: HostParamUpdate[]): void {
  for (const update of updates) sendParamUpdate(update);
}

const reloadInFlight = new Map<string, Promise<void>>();
const reloadAgain = new Set<string>();

export function reloadModuleWasm(moduleId: string | null): Promise<void> {
  // moduleId === null means a shared host header changed; reload every loaded slot.
  // Driven off the engine's own slot table rather than the store's tracks: slot
  // ids are identical across tracks, so iterating tracks reloaded the one engine
  // slot once per track (4 audio-thread instantiations per save on the default
  // state) and, with two tracks on different modules, reloaded the one that was
  // loaded rather than the one that changed.
  //
  // One pass at a time per module, with everything arriving mid-pass folded
  // into a single catch-up pass. The dev watcher fires per file event and is
  // not debounced (plan 5.5), so a burst used to start a fetch and a
  // WebAssembly.instantiate on the audio thread for every event. Dropping the
  // extra events outright would be wrong instead: the build that triggered
  // them may have finished after the in-flight pass fetched, which would leave
  // the previous binary loaded.
  const key = moduleId ?? "*";
  const existing = reloadInFlight.get(key);
  if (existing) {
    reloadAgain.add(key);
    return existing;
  }

  const pass = (async () => {
    do {
      reloadAgain.delete(key);
      for (const slotId of engine.loadedSlotIds(moduleId)) {
        // One module failing to reload must not strand the others: reloadSlot
        // throws when a .wasm is missing, and web/wasm/ is gitignored, so a
        // fresh clone hits this readily.
        try {
          await engine.reloadSlot(slotId);
        } catch (error) {
          console.error(`[moveforge] failed to reload ${slotId}`, error);
        }
      }
    } while (reloadAgain.has(key));
  })().finally(() => {
    reloadInFlight.delete(key);
    reloadAgain.delete(key);
  });

  reloadInFlight.set(key, pass);
  return pass;
}

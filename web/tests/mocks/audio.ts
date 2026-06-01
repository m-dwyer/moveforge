// Test-only stand-in for web/src/audio.ts. Vite swaps this in when run with
// --mode test. The real engine never boots, so tests don't need WASM artefacts
// or an AudioContext; they assert on the recorded call log instead.

export type AudioCall =
  | { kind: "syncChain" }
  | { kind: "noteOn"; note: number; velocity: number }
  | { kind: "noteOff"; note: number }
  | { kind: "allNotesOff" }
  | { kind: "hardPanic" }
  | { kind: "setMasterVolume"; volume: number }
  | { kind: "sendParamToSlot"; slotId: string; key: string; id: number; value: number }
  | { kind: "reloadModuleWasm"; moduleId: string | null };

export type HostParamUpdate = {
  slotId: string;
  key: string;
  id: number;
  value: number;
};

declare global {
  interface Window {
    __moveforgeAudioCalls__: AudioCall[];
    __moveforgeClearAudioCalls__: () => void;
  }
}

function record(call: AudioCall): void {
  if (typeof window === "undefined") return;
  if (!window.__moveforgeAudioCalls__) {
    window.__moveforgeAudioCalls__ = [];
    window.__moveforgeClearAudioCalls__ = () => {
      window.__moveforgeAudioCalls__ = [];
    };
  }
  window.__moveforgeAudioCalls__.push(call);
}

export async function syncChain(): Promise<void> {
  record({ kind: "syncChain" });
}

export async function noteOn(note: number, velocity = 0.94): Promise<void> {
  record({ kind: "noteOn", note, velocity });
  if (typeof document !== "undefined") {
    document.body.dataset.audio = "ready";
  }
}

export function noteOff(note: number): void {
  record({ kind: "noteOff", note });
}

export function allNotesOff(): void {
  record({ kind: "allNotesOff" });
}

export function hardPanic(): void {
  record({ kind: "hardPanic" });
}

export function setMasterVolume(volume: number): void {
  record({ kind: "setMasterVolume", volume });
}

export function sendParamUpdate(update: HostParamUpdate): void {
  record({
    kind: "sendParamToSlot",
    slotId: update.slotId,
    key: update.key,
    id: update.id,
    value: update.value
  });
}

export function sendParamUpdates(updates: HostParamUpdate[]): void {
  for (const update of updates) sendParamUpdate(update);
}

export async function reloadModuleWasm(moduleId: string | null): Promise<void> {
  record({ kind: "reloadModuleWasm", moduleId });
}

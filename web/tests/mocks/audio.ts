// Test-only stand-in for web/src/audio.ts. Vite swaps this in when run with
// --mode test. The real engine never boots, so tests don't need WASM artefacts
// or an AudioContext; they assert on the recorded call log instead.

export type AudioCall =
  | { kind: "syncChain" }
  | { kind: "noteOn"; note: number; velocity: number }
  | { kind: "noteOff"; note: number }
  | { kind: "allNotesOff" }
  | { kind: "sendParamToSlot"; slotId: string; key: string; id: number; value: number }
  | { kind: "reloadModuleWasm"; moduleId: string | null };

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

export function sendParamToSlot(slotId: string, key: string, id: number, value: number): void {
  record({ kind: "sendParamToSlot", slotId, key, id, value });
}

export async function reloadModuleWasm(moduleId: string | null): Promise<void> {
  record({ kind: "reloadModuleWasm", moduleId });
}

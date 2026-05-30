import { beforeEach, afterEach } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { createElement, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { STORE_PERSIST_KEY, useStore } from "@/store";
import { makeInitialState, type ChainSlot, type SettingsSlot, type AudioFxSlot, type MidiFxSlot, type SoundSlot } from "@/chain-state";
import "@/index.css";
import type { AudioCall } from "./mocks/audio";

declare global {
  interface Window {
    __moveforgeAudioCalls__: AudioCall[];
  }
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  window.localStorage.removeItem(STORE_PERSIST_KEY);
  useStore.setState({
    ...makeInitialState("westfold", "Westfold"),
    activeModuleName: "Westfold",
    moduleId: "westfold",
    moduleIndex: [
      { id: "arpy", name: "Arpy", kind: "midi_fx" },
      { id: "dustline", name: "Dustline", kind: "sound_generator" },
      { id: "trail", name: "Trail Delay", kind: "audio_fx" },
      { id: "westfold", name: "Westfold", kind: "sound_generator" }
    ],
    slotMeta: {},
    topLevelParams: [],
    presets: [],
    bpm: 120,
    error: null
  });
  window.__moveforgeAudioCalls__ = [];
});

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
});

export function render(node: ReactNode): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(createElement(TooltipProvider, { delayDuration: 0, children: node }));
}

export function audioCalls(): AudioCall[] {
  return window.__moveforgeAudioCalls__ ?? [];
}

export function findSlot<K extends ChainSlot["kind"]>(kind: K): Extract<ChainSlot, { kind: K }> {
  const slot = useStore.getState().tracks[0].chain.find((s) => s.kind === kind);
  if (!slot) throw new Error(`No slot found for kind ${kind}`);
  return slot as Extract<ChainSlot, { kind: K }>;
}

export type { ChainSlot, SettingsSlot, AudioFxSlot, MidiFxSlot, SoundSlot };
export { page, useStore };

import { beforeEach, afterEach } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement, type ReactNode } from "react";
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

/* React 18 gates act() behind this global and warns on every call without it.
 * Every spec imports this module, so it is the one place to set it. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    paramSnapshots: {},
    slotMeta: {},
    selectedParamSnapshot: {},
    topLevelParams: [],
    presets: [],
    randomizeAmount: "medium",
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

/**
 * Wait for React to commit and run effects.
 *
 * `createRoot().render()` schedules work rather than doing it, so a test that
 * acts on the DOM synchronously after `render` acts on a tree whose effects have
 * not run. Most tests here never noticed: they reach for the DOM through
 * `page.getBy*`, which retries until it finds something. A test that dispatches
 * an event instead gets one shot, and hits a component that has not subscribed
 * to anything yet.
 *
 * This drains React's work loop rather than waiting a tick. `setTimeout(0)` was
 * not a barrier: React 18 flushes passive effects on a MessageChannel task, and
 * whether that lands before a clamped timer is an event-loop implementation
 * detail. It held on macOS and failed in CI on KeyboardPlay.spec.tsx, which
 * dispatches a keydown at a hook that had not yet attached its listener.
 */
export async function flushEffects(): Promise<void> {
  await act(async () => {});
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

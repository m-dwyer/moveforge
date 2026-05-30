import { test, expect } from "vitest";
import { STORE_PERSIST_KEY } from "@/store";
import { useStore } from "./fixtures";

test("persists audition, bpm, steps, and params without runtime fields", () => {
  useStore.getState().setBpm(132);
  useStore.getState().setMasterVolume(0.42);
  useStore.getState().setAuditionPattern("octave_bounce");
  useStore.getState().toggleStep(0);
  useStore.getState().forkAuditionToCustomCopy([{ enabled: true, note: 48, velocity: 0.8, locks: {} }]);
  useStore.setState({
    error: "do not persist",
    playing: true,
    playStep: 7,
    topLevelParams: [
      { key: "fold", label: "Fold", id: 0, value: 0.64, min: 0, max: 1, step: 0.01, default: 0.35, type: "float" }
    ]
  });

  const raw = window.localStorage.getItem(STORE_PERSIST_KEY);
  expect(raw).toBeTruthy();
  const parsed = JSON.parse(raw!);
  expect(parsed.state.bpm).toBe(132);
  expect(parsed.state.masterVolume).toBe(0.42);
  expect(parsed.state.audition.pattern).toBe("custom_copy");
  expect(parsed.state.customCopySteps[0].note).toBe(48);
  expect(parsed.state.steps[0].enabled).toBe(true);
  expect(parsed.state.topLevelParams[0].value).toBe(0.64);
  expect(parsed.state.error).toBeUndefined();
  expect(parsed.state.playing).toBeUndefined();
  expect(parsed.state.playStep).toBeUndefined();
  expect(parsed.state.moduleIndex).toBeUndefined();
  expect(parsed.state.slotMeta).toBeUndefined();
  expect(parsed.state.tracks[0].activeNotes).toBeUndefined();
  expect(parsed.state.tracks[0].moveEchoEvents).toBeUndefined();
});

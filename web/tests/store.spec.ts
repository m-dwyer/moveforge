import { afterEach, test, expect, vi } from "vitest";
import { STORE_PERSIST_KEY, trackSlotKey } from "@/store";
import { audioCalls, useStore } from "./fixtures";

afterEach(() => {
  vi.restoreAllMocks();
});

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

test("tracks keep independent sequencer state", async () => {
  useStore.getState().toggleStep(0);
  useStore.getState().setStepNote(0, 48);

  await useStore.getState().selectTrack(1);
  expect(useStore.getState().steps[0].enabled).toBe(false);

  useStore.getState().toggleStep(2);
  useStore.getState().setStepNote(2, 67);

  await useStore.getState().selectTrack(0);
  expect(useStore.getState().steps[0].enabled).toBe(true);
  expect(useStore.getState().steps[0].note).toBe(48);
  expect(useStore.getState().steps[2].enabled).toBe(false);

  await useStore.getState().selectTrack(1);
  expect(useStore.getState().steps[0].enabled).toBe(false);
  expect(useStore.getState().steps[2].enabled).toBe(true);
  expect(useStore.getState().steps[2].note).toBe(67);
});

test("tracks keep independent sound params", async () => {
  await useStore.getState().initialize("westfold");
  useStore.getState().setTopLevelParam("fold", 0.81);

  await useStore.getState().selectTrack(1);
  await useStore.getState().setTopLevelModule("westfold");
  expect(useStore.getState().topLevelParams.find((p) => p.key === "fold")?.value).not.toBe(0.81);

  useStore.getState().setTopLevelParam("fold", 0.22);

  await useStore.getState().selectTrack(0);
  expect(useStore.getState().topLevelParams.find((p) => p.key === "fold")?.value).toBe(0.81);

  await useStore.getState().selectTrack(1);
  expect(useStore.getState().topLevelParams.find((p) => p.key === "fold")?.value).toBe(0.22);
});

test("tracks keep independent sound and fx modules", async () => {
  await useStore.getState().setTopLevelModule("dustline");
  await useStore.getState().setSlotModule(0, 2, "trail");

  await useStore.getState().selectTrack(1);
  expect(useStore.getState().moduleId).toBe("westfold");
  expect(audioFxModuleId(1, 2)).toBe(null);

  await useStore.getState().setSlotModule(1, 2, "faust_drive");
  expect(useStore.getState().slotMeta[trackSlotKey(1, "audio-fx-1")]?.moduleJson.id).toBe("faust_drive");

  await useStore.getState().selectTrack(0);
  expect(useStore.getState().moduleId).toBe("dustline");
  expect(audioFxModuleId(0, 2)).toBe("trail");
  expect(useStore.getState().slotMeta[trackSlotKey(0, "audio-fx-1")]?.moduleJson.id).toBe("trail");

  await useStore.getState().selectTrack(1);
  expect(useStore.getState().moduleId).toBe("westfold");
  expect(audioFxModuleId(1, 2)).toBe("faust_drive");
});

test("persists distinct multi-track sound and sequencer state", async () => {
  await useStore.getState().setTopLevelModule("dustline");
  useStore.getState().toggleStep(0);
  useStore.getState().setStepNote(0, 45);

  await useStore.getState().selectTrack(1);
  useStore.getState().toggleStep(3);
  useStore.getState().setStepNote(3, 72);

  const raw = window.localStorage.getItem(STORE_PERSIST_KEY);
  expect(raw).toBeTruthy();
  const parsed = JSON.parse(raw!);
  expect(parsed.state.tracks[0].chain[1].moduleId).toBe("dustline");
  expect(parsed.state.tracks[0].steps[0].enabled).toBe(true);
  expect(parsed.state.tracks[0].steps[0].note).toBe(45);
  expect(parsed.state.tracks[1].chain[1].moduleId).toBe("westfold");
  expect(parsed.state.tracks[1].steps[3].enabled).toBe(true);
  expect(parsed.state.tracks[1].steps[3].note).toBe(72);
});

test("randomizes selected sound params within declared bounds and step", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  await useStore.getState().initialize("westfold");

  useStore.getState().randomizeSelectedSlotParams();

  const fold = useStore.getState().topLevelParams.find((p) => p.key === "fold");
  expect(fold?.value).toBe(0.5);
  const sound = useStore.getState().tracks[0].chain[1];
  if (sound.kind !== "sound_generator") throw new Error("Expected sound slot");
  expect(sound.params.fold).toBe(0.5);
});

test("randomizes selected audio fx slot params independently", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.25);
  await useStore.getState().setSlotModule(0, 2, "trail");
  useStore.setState({ selectedSlot: 2 });

  useStore.getState().randomizeSelectedSlotParams();

  const slot = useStore.getState().tracks[0].chain[2];
  if (slot.kind !== "audio_fx") throw new Error("Expected audio FX slot");
  expect(slot.params.mix).toBeGreaterThanOrEqual(0);
  expect(slot.params.mix).toBeLessThanOrEqual(1);
  expect(useStore.getState().slotPreset[trackSlotKey(0, "audio-fx-1")]).toBe("Random");
});

test("captures and recalls selected sound param snapshots", () => {
  useStore.setState({
    selectedSlot: 1,
    topLevelParams: [
      { key: "fold", label: "Fold", id: 0, value: 0.25, min: 0, max: 1, step: 0.01, default: 0.35, type: "float" },
      { key: "tone", label: "Tone", id: 1, value: 0.7, min: 0, max: 1, step: 0.01, default: 0.5, type: "float" }
    ]
  });

  useStore.getState().captureParamSnapshot("A");
  useStore.getState().setTopLevelParam("fold", 0.8);
  useStore.getState().setTopLevelParam("tone", 0.2);
  useStore.getState().recallParamSnapshot("A");

  expect(useStore.getState().topLevelParams.find((p) => p.key === "fold")?.value).toBe(0.25);
  expect(useStore.getState().topLevelParams.find((p) => p.key === "tone")?.value).toBe(0.7);
  expect(audioCalls()).toContainEqual({ kind: "sendParamToSlot", slotId: "sound", key: "fold", id: 0, value: 0.25 });
  expect(audioCalls()).toContainEqual({ kind: "sendParamToSlot", slotId: "sound", key: "tone", id: 1, value: 0.7 });
});

test("swaps live sound params with a snapshot", () => {
  useStore.setState({
    selectedSlot: 1,
    topLevelParams: [
      { key: "fold", label: "Fold", id: 0, value: 0.25, min: 0, max: 1, step: 0.01, default: 0.35, type: "float" }
    ]
  });

  useStore.getState().captureParamSnapshot("B");
  useStore.getState().setTopLevelParam("fold", 0.9);
  useStore.getState().swapParamSnapshot("B");

  expect(useStore.getState().topLevelParams.find((p) => p.key === "fold")?.value).toBe(0.25);
  useStore.getState().recallParamSnapshot("B");
  expect(useStore.getState().topLevelParams.find((p) => p.key === "fold")?.value).toBe(0.9);
});

function audioFxModuleId(trackIndex: number, slotIndex: number): string | null {
  const slot = useStore.getState().tracks[trackIndex].chain[slotIndex];
  if (slot.kind !== "audio_fx") throw new Error("Expected audio FX slot");
  return slot.moduleId;
}

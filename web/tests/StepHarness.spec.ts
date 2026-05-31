import { createElement } from "react";
import { afterEach, test, expect, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render, page, useStore, audioCalls } from "./fixtures";
import { AppRoot } from "@/AppRoot";
import { StepHarness } from "@/components/StepHarness";

afterEach(() => {
  vi.useRealTimers();
});

test("audition controls update the persistent sequencer state", async () => {
  render(createElement(StepHarness));

  await page.getByRole("combobox").nth(0).selectOptions("bass_pulse");
  await page.getByRole("combobox").nth(1).selectOptions("8");

  expect(useStore.getState().audition.pattern).toBe("bass_pulse");
  expect(useStore.getState().audition.length).toBe(8);
});

test("header panic stops playback and sends hard panic", async () => {
  useStore.getState().setPlaying(true);
  render(createElement(AppRoot));

  await page.getByRole("button", { name: "Panic" }).click();

  expect(useStore.getState().playing).toBe(false);
  expect(audioCalls().some((call) => call.kind === "hardPanic")).toBe(true);
});

test("header volume controls persistent master volume", async () => {
  render(createElement(AppRoot));

  const volume = page.getByRole("slider").first();
  await volume.click();
  await userEvent.keyboard("{ArrowLeft}");

  expect(useStore.getState().masterVolume).toBeLessThan(0.55);
  expect(audioCalls().some((call) => call.kind === "setMasterVolume")).toBe(true);
});

test("rendered track switch shows each track's own chain and steps", async () => {
  await useStore.getState().setTopLevelModule("dustline");
  await useStore.getState().setSlotModule(0, 2, "trail");
  useStore.getState().toggleStep(0);

  render(createElement(AppRoot));

  await expect.element(page.getByTestId("panel-title")).toHaveTextContent("Dustline");
  await expect.element(page.getByText("Trail Delay")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "1", exact: true })).toHaveClass(/border-accent/);

  await page.getByRole("button", { name: "Track 2" }).click();

  await expect.element(page.getByTestId("panel-title")).toHaveTextContent("Westfold");
  expect(await page.getByText("Trail Delay").elements()).toHaveLength(0);
  await expect.element(page.getByRole("button", { name: "1", exact: true })).not.toHaveClass(/border-accent/);
});

test("randomize button is shown with module presets", async () => {
  render(createElement(AppRoot));

  await expect.element(page.getByRole("button", { name: "Randomize" })).toBeVisible();
});

test("clicking randomize updates sound params and sends audio param changes", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  render(createElement(AppRoot));

  await page.getByRole("button", { name: "Randomize" }).click();

  await expect.poll(() => useStore.getState().topLevelParams.find((p) => p.key === "fold")?.value).toBe(0.35);
  expect(audioCalls().some((call) => call.kind === "sendParamToSlot" && call.key === "fold" && call.value === 0.35)).toBe(true);
});

test("custom steps can still be programmed", async () => {
  render(createElement(StepHarness));

  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click({ modifiers: ["Shift"] });

  expect(useStore.getState().steps[0].enabled).toBe(true);
  expect(useStore.getState().selectedStep).toBe(1);
});

test("clicking a generated pattern step forks it into Custom Copy", async () => {
  render(createElement(StepHarness));

  await page.getByRole("combobox").nth(0).selectOptions("octave_bounce");
  await page.getByRole("button", { name: "1", exact: true }).click();

  const state = useStore.getState();
  expect(state.audition.pattern).toBe("custom_copy");
  expect(state.steps[0].enabled).toBe(false);
  expect(state.customCopySteps[0].enabled).toBe(false);
  expect(state.customCopySteps[2].enabled).toBe(true);
});

test("32-step length renders all steps even with older 16-step state", async () => {
  useStore.setState((state) => {
    state.steps = state.steps.slice(0, 16);
    state.customCopySteps = state.customCopySteps.slice(0, 16);
    state.audition.length = 32;
  });

  render(createElement(StepHarness));

  await expect.element(page.getByRole("button", { name: "32", exact: true })).toBeVisible();
});

test("bass pulse note length schedules short note-offs", async () => {
  vi.useFakeTimers();
  useStore.setState((state) => {
    state.audition.pattern = "bass_pulse";
    state.audition.gate = 0.08;
    state.bpm = 120;
  });

  render(createElement(StepHarness));
  await page.getByRole("button", { name: "Play" }).click();

  expect(audioCalls().some((call) => call.kind === "noteOn")).toBe(true);
  expect(audioCalls().some((call) => call.kind === "noteOff")).toBe(false);

  vi.advanceTimersByTime(31);

  expect(audioCalls().some((call) => call.kind === "noteOff")).toBe(true);
});

import { createElement } from "react";
import { test, expect } from "vitest";
import { userEvent } from "vitest/browser";
import { render, page, useStore, audioCalls } from "./fixtures";
import { AppRoot } from "@/AppRoot";
import { StepHarness } from "@/components/StepHarness";

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

import { createElement } from "react";
import { test, expect } from "vitest";
import { userEvent } from "vitest/browser";
import { render, page, useStore, audioCalls } from "./fixtures";
import { Controls } from "@/components/Controls";

test("renders settings rows when the settings slot is selected", async () => {
  useStore.setState({ selectedSlot: 4 });
  render(createElement(Controls));

  await expect.element(page.getByTestId("controls")).toHaveTextContent(/Slot Vol/);
  await expect.element(page.getByTestId("controls")).toHaveTextContent(/MIDI Out/);
});

test("falls back to default audio_fx params when no module is loaded", async () => {
  useStore.setState({ selectedSlot: 2 });
  render(createElement(Controls));

  const controls = page.getByTestId("controls");
  await expect.element(controls).toHaveTextContent(/Drive/);
  await expect.element(controls).toHaveTextContent(/Tone/);
  await expect.element(controls).toHaveTextContent(/Wet/);
});

test("renders top-level params and fires sendParamToSlot on slider change", async () => {
  useStore.setState({
    selectedSlot: 1,
    topLevelParams: [
      { key: "fold", label: "Fold", id: 0, value: 0.5, min: 0, max: 1, step: 0.01, default: 0.5, type: "float" }
    ]
  });
  render(createElement(Controls));

  const controls = page.getByTestId("controls");
  await expect.element(controls).toHaveTextContent(/Fold/);

  // Radix Slider responds to ArrowRight when focused.
  const slider = page.getByRole("slider");
  await slider.click();
  await userEvent.keyboard("{ArrowRight}");

  expect(useStore.getState().topLevelParams[0].value).toBeGreaterThan(0.5);
  const paramCalls = audioCalls().filter((c) => c.kind === "sendParamToSlot");
  expect(paramCalls.length).toBeGreaterThan(0);
});

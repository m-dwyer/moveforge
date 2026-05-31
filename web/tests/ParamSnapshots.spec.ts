import { createElement } from "react";
import { test, expect } from "vitest";
import { render, page, useStore } from "./fixtures";
import { ParamSnapshots } from "@/components/ParamSnapshots";

test("captures and recalls snapshot buttons for the selected sound", async () => {
  useStore.setState({
    selectedSlot: 1,
    topLevelParams: [
      { key: "fold", label: "Fold", id: 0, value: 0.25, min: 0, max: 1, step: 0.01, default: 0.35, type: "float" }
    ]
  });
  render(createElement(ParamSnapshots));

  await page.getByRole("button", { name: "Capture" }).click();
  useStore.getState().setTopLevelParam("fold", 0.82);

  await page.getByRole("button", { name: "A", exact: true }).click();

  expect(useStore.getState().topLevelParams[0].value).toBe(0.25);
});

test("clears the selected snapshot", async () => {
  useStore.setState({
    selectedSlot: 1,
    topLevelParams: [
      { key: "fold", label: "Fold", id: 0, value: 0.25, min: 0, max: 1, step: 0.01, default: 0.35, type: "float" }
    ]
  });
  render(createElement(ParamSnapshots));

  await page.getByRole("button", { name: "Capture" }).click();
  await page.getByRole("button", { name: "Clear" }).click();

  expect(Object.keys(useStore.getState().paramSnapshots["0:sound:westfold"] ?? {})).toHaveLength(0);
});

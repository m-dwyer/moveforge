import { createElement } from "react";
import { test, expect } from "vitest";
import { render, page, useStore, findSlot } from "./fixtures";
import { ChainSlot } from "@/components/ChainSlot";

test("sound_generator picker lists sound generators only", async () => {
  const slot = findSlot("sound_generator");
  render(createElement(ChainSlot, { slot, trackIndex: 0, slotIndex: 1 }));

  await page.getByTestId("slot-picker").click();

  await expect.element(page.getByRole("option", { name: "Westfold", exact: true })).toBeVisible();
  await expect.element(page.getByRole("option", { name: "Dustline", exact: true })).toBeVisible();
  expect(await page.getByRole("option", { name: "Arpy", exact: true }).elements()).toHaveLength(0);
  expect(await page.getByRole("option", { name: "Trail Delay", exact: true }).elements()).toHaveLength(0);
});

test("midi_fx picker lists midi_fx modules and selecting one updates the store", async () => {
  const slot = findSlot("midi_fx");
  render(createElement(ChainSlot, { slot, trackIndex: 0, slotIndex: 0 }));

  await page.getByTestId("slot-picker").click();
  await page.getByRole("option", { name: "Arpy", exact: true }).click();

  // The store reflects the pick; the next render of ChainSlot would show "Arpy".
  // (No top-level metadata fetch in this isolated render, so we observe state directly.)
  await expect.poll(() => findSlot("midi_fx").moduleId).toBe("arpy");
  expect(findSlot("midi_fx").name).toBe("Arpy");
});

test("audio_fx picker shows a clear option once a module is loaded", async () => {
  // Seed an already-loaded audio_fx slot directly.
  useStore.setState((s) => {
    const slot = s.tracks[0].chain[2];
    if (slot.kind !== "audio_fx") return;
    slot.moduleId = "trail";
    slot.name = "Trail Delay";
    slot.enabled = true;
  });

  const slot = findSlot("audio_fx");
  render(createElement(ChainSlot, { slot, trackIndex: 0, slotIndex: 2 }));

  await page.getByTestId("slot-picker").click();
  await expect.element(page.getByRole("option", { name: "— Empty —" })).toBeVisible();

  await page.getByRole("option", { name: "— Empty —" }).click();
  await expect.poll(() => findSlot("audio_fx").moduleId).toBe(null);
  expect(findSlot("audio_fx").name).toBe("Empty");
});

test("settings slot renders its name and skips the picker", async () => {
  const slot = findSlot("settings");
  render(createElement(ChainSlot, { slot, trackIndex: 0, slotIndex: 4 }));

  await expect.element(page.getByTestId("chain-slot")).toHaveTextContent(/Slot Settings/);
  expect(await page.getByTestId("slot-picker").elements()).toHaveLength(0);
});

test("clicking a non-settings row selects it in the store", async () => {
  const slot = findSlot("midi_fx");
  // Pre-state: default selectedSlot is 1.
  expect(useStore.getState().selectedSlot).toBe(1);

  render(createElement(ChainSlot, { slot, trackIndex: 0, slotIndex: 0 }));

  await page.getByTestId("chain-slot").click({ position: { x: 10, y: 10 } });
  expect(useStore.getState().selectedSlot).toBe(0);
});

test("toggling bypass on a midi_fx slot flips the enabled flag", async () => {
  useStore.setState((s) => {
    const slot = s.tracks[0].chain[0];
    if (slot.kind !== "midi_fx") return;
    slot.moduleId = "arpy";
    slot.name = "Arpy";
    slot.enabled = true;
  });

  const slot = findSlot("midi_fx");
  render(createElement(ChainSlot, { slot, trackIndex: 0, slotIndex: 0 }));

  await page.getByRole("switch", { name: /Bypass/i }).click();
  expect(findSlot("midi_fx").enabled).toBe(false);
});

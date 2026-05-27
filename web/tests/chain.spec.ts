import { test, expect, pickModule, clearSlot, selectSlot } from "./fixtures";

test("sound-generator picker lists sound generators only", async ({ page }) => {
  const soundRow = page.locator("[data-testid=chain-slot][data-slot-kind=sound_generator]");
  await soundRow.getByTestId("slot-picker").click();

  await expect(page.getByRole("option", { name: "Westfold", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Dustline", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Arpy", exact: true })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Trail Delay", exact: true })).toHaveCount(0);

  await page.keyboard.press("Escape");
});

test("switching to Dustline updates title and controls", async ({ page }) => {
  await expect(page.getByTestId("panel-title")).toHaveText("Westfold");

  await pickModule(page, "sound_generator", "Dustline");

  await expect(page.getByTestId("panel-title")).toHaveText("Dustline");
  const controls = page.getByTestId("controls");
  await expect(controls).toContainText("Wave");
  await expect(controls).toContainText("Noise");
  await expect(controls).toContainText("Cutoff");
});

test("chain exposes 5 slots in the canonical order", async ({ page }) => {
  const slots = page.getByTestId("chain-slot");
  await expect(slots).toHaveCount(5);

  const kinds = await slots.evaluateAll((nodes) =>
    nodes.map((n) => (n as HTMLElement).dataset.slotKind)
  );
  expect(kinds).toEqual(["midi_fx", "sound_generator", "audio_fx", "audio_fx", "settings"]);

  await expect(slots.nth(0)).toContainText("MIDI FX");
  await expect(slots.nth(1)).toContainText("Sound");
  await expect(slots.nth(2)).toContainText("Audio FX 1");
  await expect(slots.nth(3)).toContainText("Audio FX 2");
  await expect(slots.nth(4)).toContainText("Settings");
});

test("audio FX slot loads Trail Delay and clears back to empty", async ({ page }) => {
  await pickModule(page, "audio_fx", "Trail Delay");

  const slot = page.locator("[data-testid=chain-slot][data-slot-kind=audio_fx]").first();
  await expect(slot).toContainText("Trail Delay");
  await expect(page.getByTestId("controls")).toContainText("Time");

  await clearSlot(page, "audio_fx");
  await expect(slot).toContainText("— Empty —");
});

test("MIDI FX slot loads Arpy and clears back to empty", async ({ page }) => {
  await pickModule(page, "midi_fx", "Arpy");

  const slot = page.locator("[data-testid=chain-slot][data-slot-kind=midi_fx]");
  await expect(slot).toContainText("Arpy");
  await expect(page.getByTestId("controls")).toContainText("Pattern");

  await clearSlot(page, "midi_fx");
  await expect(slot).toContainText("— Empty —");
});

test("settings slot shows slot-scoped rows", async ({ page }) => {
  await selectSlot(page, "settings");
  const controls = page.getByTestId("controls");
  await expect(controls).toContainText("Slot Vol");
  await expect(controls).toContainText("MIDI Out");
});

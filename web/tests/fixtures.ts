import { expect, test as base, type Page } from "@playwright/test";
import type { AudioCall } from "./mocks/audio";

export const test = base.extend<object>({
  page: async ({ page }, use) => {
    await page.goto("/");
    await expect(page.getByTestId("chain-slot").first()).toBeVisible();
    await use(page);
  }
});

export { expect };

export async function audioCalls(page: Page): Promise<AudioCall[]> {
  return page.evaluate(() => window.__moveforgeAudioCalls__ ?? []);
}

export async function clearAudioCalls(page: Page): Promise<void> {
  await page.evaluate(() => window.__moveforgeClearAudioCalls__?.());
}

// Click the row at the leftmost (type-label) area, away from the picker and
// bypass switch, so the slot becomes selected without opening the picker as a
// side effect.
export async function selectSlot(
  page: Page,
  slotKind: "sound_generator" | "midi_fx" | "audio_fx" | "settings",
  which = 0
): Promise<void> {
  const row = page.locator(`[data-testid=chain-slot][data-slot-kind=${slotKind}]`).nth(which);
  await row.click({ position: { x: 10, y: 10 } });
}

// Open the picker for the given slot kind and click the option with the
// visible name. Also selects the slot so its params appear in the controls
// panel.
export async function pickModule(
  page: Page,
  slotKind: "sound_generator" | "midi_fx" | "audio_fx",
  name: string,
  which = 0
): Promise<void> {
  await selectSlot(page, slotKind, which);
  const row = page.locator(`[data-testid=chain-slot][data-slot-kind=${slotKind}]`).nth(which);
  await row.getByTestId("slot-picker").click();
  await page.getByRole("option", { name, exact: true }).click();
}

export async function clearSlot(
  page: Page,
  slotKind: "midi_fx" | "audio_fx",
  which = 0
): Promise<void> {
  const row = page.locator(`[data-testid=chain-slot][data-slot-kind=${slotKind}]`).nth(which);
  await row.getByTestId("slot-picker").click();
  await page.getByRole("option", { name: "— Empty —" }).click();
}

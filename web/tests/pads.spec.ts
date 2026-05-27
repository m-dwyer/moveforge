import { test, expect, audioCalls, clearAudioCalls } from "./fixtures";

test("clicking a pad fires noteOn and marks audio ready", async ({ page }) => {
  await clearAudioCalls(page);

  const firstPad = page.getByTestId("pad").first();
  await firstPad.click();

  await expect(page.locator("body")).toHaveAttribute("data-audio", "ready");

  const calls = await audioCalls(page);
  const noteOns = calls.filter((c): c is Extract<typeof c, { kind: "noteOn" }> => c.kind === "noteOn");
  expect(noteOns.length).toBeGreaterThan(0);
  expect(typeof noteOns[0].note).toBe("number");
  expect(noteOns[0].velocity).toBeGreaterThan(0);
});

test("releasing a pad fires noteOff for the same note", async ({ page }) => {
  await clearAudioCalls(page);

  const firstPad = page.getByTestId("pad").first();
  await firstPad.click();

  const calls = await audioCalls(page);
  const noteOns = calls.filter((c): c is Extract<typeof c, { kind: "noteOn" }> => c.kind === "noteOn");
  const noteOffs = calls.filter((c): c is Extract<typeof c, { kind: "noteOff" }> => c.kind === "noteOff");
  expect(noteOns.length).toBeGreaterThan(0);
  expect(noteOffs.length).toBeGreaterThan(0);
  expect(noteOffs[noteOffs.length - 1].note).toBe(noteOns[noteOns.length - 1].note);
});

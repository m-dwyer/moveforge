import { createElement } from "react";
import { test, expect } from "vitest";
import { render, page, audioCalls } from "./fixtures";
import { PadGrid } from "@/components/PadGrid";

test("clicking a pad fires noteOn and marks audio ready", async () => {
  render(createElement(PadGrid));

  await page.getByTestId("pad").first().click();

  await expect.element(page.getByTestId("pad").first()).toBeVisible();
  expect(document.body.dataset.audio).toBe("ready");

  const noteOns = audioCalls().filter((c) => c.kind === "noteOn");
  expect(noteOns.length).toBeGreaterThan(0);
  expect(typeof (noteOns[0] as { note: number }).note).toBe("number");
});

test("clicking a pad fires a matching noteOff afterwards", async () => {
  render(createElement(PadGrid));

  await page.getByTestId("pad").first().click();

  const noteOns = audioCalls().filter((c): c is Extract<typeof c, { kind: "noteOn" }> => c.kind === "noteOn");
  const noteOffs = audioCalls().filter((c): c is Extract<typeof c, { kind: "noteOff" }> => c.kind === "noteOff");
  expect(noteOns.length).toBeGreaterThan(0);
  expect(noteOffs.length).toBeGreaterThan(0);
  expect(noteOffs[noteOffs.length - 1].note).toBe(noteOns[noteOns.length - 1].note);
});

import { createElement } from "react";
import { test, expect } from "vitest";
import { render, page, audioCalls, flushEffects } from "./fixtures";
import { useKeyboardPlay } from "@/lib/keyboard";
import { PadGrid } from "@/components/PadGrid";

function KeyboardHarness() {
  useKeyboardPlay();
  return createElement("div");
}

function KeyboardAndPadsHarness() {
  useKeyboardPlay();
  return createElement(PadGrid);
}

test("computer keyboard sustains a note until physical key release", async () => {
  render(createElement(KeyboardHarness));
  await flushEffects();

  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyA", key: "a" }));
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyA", key: "a", repeat: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyA", key: "a" }));

  const noteOns = audioCalls().filter((call) => call.kind === "noteOn");
  const noteOffsBeforeRelease = audioCalls().filter((call) => call.kind === "noteOff");
  expect(noteOns).toHaveLength(1);
  expect(noteOffsBeforeRelease).toHaveLength(0);

  window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, code: "KeyA", key: "a" }));

  const noteOffs = audioCalls().filter((call) => call.kind === "noteOff");
  expect(noteOffs).toHaveLength(1);
  expect(noteOffs[0].note).toBe(noteOns[0].note);
});

test("computer keyboard releases held notes on window blur", async () => {
  render(createElement(KeyboardHarness));
  await flushEffects();

  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyS", key: "s" }));
  window.dispatchEvent(new Event("blur"));

  const noteOns = audioCalls().filter((call) => call.kind === "noteOn");
  const noteOffs = audioCalls().filter((call) => call.kind === "noteOff");
  expect(noteOns).toHaveLength(1);
  expect(noteOffs).toHaveLength(1);
  expect(noteOffs[0].note).toBe(noteOns[0].note);
});

test("computer keyboard lights the matching pad while held", async () => {
  render(createElement(KeyboardAndPadsHarness));

  /* Wait for the grid to be on screen before dispatching. PadGrid commits in
   * more passes than a bare div — memoised note list, one store subscription per
   * pad — so a fixed tick is not enough to guarantee useKeyboardPlay's effect has
   * attached its listener, and a keydown into a page with no listener is silently
   * a no-op. */
  const firstPad = page.getByTestId("pad").first();
  await expect.element(firstPad).toBeInTheDocument();

  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "KeyA", key: "a" }));

  await expect.element(firstPad).toHaveAttribute("data-active", "true");

  window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, code: "KeyA", key: "a" }));

  await expect.element(firstPad).not.toHaveAttribute("data-active");
});

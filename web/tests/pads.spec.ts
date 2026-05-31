import { test, expect } from "vitest";
import { scales } from "@/chain-state";
import { SCALE_OPTIONS } from "@/components/PadConfig";
import { noteForPad } from "@/lib/pads";

test("expanded scale selector options stay wired to scale definitions", () => {
  const optionValues = SCALE_OPTIONS.map((option) => option.value);

  expect(optionValues).toEqual(Object.keys(scales));
  expect(SCALE_OPTIONS.map((option) => option.label)).toContain("Dorian");
  expect(SCALE_OPTIONS.map((option) => option.label)).toContain("Blues");
  expect(SCALE_OPTIONS.map((option) => option.label)).toContain("Whole Tone");
  expect(SCALE_OPTIONS.map((option) => option.label)).toContain("Diminished");
});

test("noteForPad uses expanded scale intervals", () => {
  const base = { padLayout: "in-key-octaves" as const, root: 0, octave: 3 };

  expect(noteForPad(1, { ...base, scale: "dorian" })).toBe(50);
  expect(noteForPad(1, { ...base, scale: "blues" })).toBe(51);
  expect(noteForPad(3, { ...base, scale: "whole_tone" })).toBe(54);
  expect(noteForPad(2, { ...base, scale: "diminished" })).toBe(51);
});

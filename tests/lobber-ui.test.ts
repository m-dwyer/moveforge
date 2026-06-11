import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { resolve } from "node:path";

// Loads the solo-mode ui.js into a sandbox so its pad handling can be tested
// without a Move. Strips the device-path ES imports/exports and injects mocks
// for the shared helpers + host globals it calls, recording every host call.

type Call = { fn: string; args: unknown[] };

function loadUi() {
  const path = resolve(import.meta.dirname, "../src/modules/lobber/ui.js");
  let src = readFileSync(path, "utf8");
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']*["'];?/g, "");
  src = src.replace(/\bexport\s+/g, ""); // top-level fns then land on the sandbox global

  const calls: Call[] = [];
  const rec = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };

  const MovePads = Array.from({ length: 32 }, (_, i) => i + 68); // notes 68..99
  const sandbox: Record<string, unknown> = {
    MovePads, Cyan: 14, Red: 127,
    setLED: rec("setLED"),
    clearAllLEDs: rec("clearAllLEDs"),
    host_pad_block: rec("host_pad_block"),
    host_module_send_midi: rec("host_module_send_midi"),
    clear_screen: rec("clear_screen"),
    print: rec("print"),
    Math, console
  };
  sandbox.globalThis = sandbox;
  createContext(sandbox);
  runInContext(src, sandbox, { filename: path });
  return { sandbox: sandbox as Record<string, any>, calls };
}

function sent(calls: Call[]) {
  return calls.filter((c) => c.fn === "host_module_send_midi").map((c) => c.args[0]);
}

describe("lobber ui.js pad handling", () => {
  let ctx: ReturnType<typeof loadUi>;
  beforeEach(() => { ctx = loadUi(); });

  it("blocks pads from Move on init", () => {
    ctx.sandbox.init();
    expect(ctx.calls.some((c) => c.fn === "host_pad_block" && c.args[0] === true)).toBe(true);
  });

  it("maps the first 16 pads to slice offsets 0..15, others to -1", () => {
    expect(ctx.sandbox.padToOffset(68)).toBe(0);   // leftmost pad = now
    expect(ctx.sandbox.padToOffset(70)).toBe(2);
    expect(ctx.sandbox.padToOffset(83)).toBe(15);  // last toss pad
    expect(ctx.sandbox.padToOffset(84)).toBe(-1);  // 17th pad — out of toss grid
    expect(ctx.sandbox.padToOffset(60)).toBe(-1);  // not a pad note at all
  });

  it("injects note on at the pad's offset and lights it active", () => {
    ctx.sandbox.init();
    ctx.calls.length = 0;
    ctx.sandbox.onMidiMessageInternal([0x90, 70, 100]); // pad index 2
    expect(sent(ctx.calls)).toEqual([[0x90, 2, 100]]);
    expect(ctx.calls.some((c) => c.fn === "setLED" && c.args[0] === 70 && c.args[1] === 127)).toBe(true);
  });

  it("injects note off and restores the pad on release", () => {
    ctx.sandbox.init();
    ctx.sandbox.onMidiMessageInternal([0x90, 70, 100]);
    ctx.calls.length = 0;
    ctx.sandbox.onMidiMessageInternal([0x80, 70, 0]);
    expect(sent(ctx.calls)).toEqual([[0x80, 2, 0]]);
    expect(ctx.calls.some((c) => c.fn === "setLED" && c.args[0] === 70 && c.args[1] === 14)).toBe(true);
  });

  it("ignores non-pad MIDI", () => {
    ctx.sandbox.init();
    ctx.calls.length = 0;
    ctx.sandbox.onMidiMessageInternal([0x90, 60, 100]); // not a pad
    ctx.sandbox.onMidiMessageInternal([0xB0, 14, 64]);  // a CC
    expect(sent(ctx.calls)).toEqual([]);
  });
});

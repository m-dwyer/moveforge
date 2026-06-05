import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { type DrawCall, loadChainUi } from "./harness";

/**
 * Behavioural coverage for the generated chain UI's output scope, exercised
 * locally (no device). This catches the class of bug that previously only
 * surfaced on the Move: e.g. a draw guard referencing a removed variable so the
 * scope silently never drew in params mode. Runs for every module that ships a
 * scope, in BOTH preset and params modes.
 */

const MODULES_DIR = "src/modules";

function scopeModuleIds(): string[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .filter((id) => {
      const mj = `${MODULES_DIR}/${id}/module.json`;
      if (!existsSync(mj)) return false;
      const scope = JSON.parse(readFileSync(mj, "utf8")).capabilities?.scope;
      return scope && scope.style !== "none";
    });
}

// A valid serialized frame: 128 columns x (max-row, min-row), each 48 + row.
// Rows 16 and 48 give a visible band well inside the 0..63 range.
function fakeScopeFrame(): string {
  let s = "";
  for (let c = 0; c < 128; c++) s += String.fromCharCode(48 + 16) + String.fromCharCode(48 + 48);
  return s;
}

// The scope draws vertical draw_line(c, yTop, c, yBot) inside the overlay band
// (~y16..56). The base preset/param UI never calls draw_line, so any in-band
// vertical line means the scope rendered.
function scopeDrawn(draws: DrawCall[]): boolean {
  return draws.some((d) => {
    if (d.op !== "draw_line") return false;
    const [x1, y1, x2, y2] = d.args;
    return x1 === x2 && Math.min(y1, y2) >= 14 && Math.max(y1, y2) <= 58;
  });
}

function tick(ui: { tick: () => void }, n: number): void {
  for (let i = 0; i < n; i++) ui.tick();
}

describe("chain UI output scope", () => {
  const ids = scopeModuleIds();

  it("there is at least one module with a scope to cover", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  for (const id of ids) {
    for (const [modeName, presetCount] of [
      ["preset", "4"],
      ["params", "0"]
    ] as const) {
      it(`${id}: shows/hides the scope in ${modeName} mode`, () => {
        const h = loadChainUi(`${MODULES_DIR}/${id}/ui_chain.js`);
        h.setParam("preset_count", presetCount);
        h.setParam("preset", "0");
        h.setParam("preset_name", "Test");
        h.setParam("__scope", null); // silent

        h.ui.init();
        tick(h.ui, 8);
        expect(scopeDrawn(h.draws), "must not draw while __scope is empty").toBe(false);

        // sounding: a non-empty frame arrives
        h.reset();
        h.setParam("__scope", fakeScopeFrame());
        tick(h.ui, 8);
        expect(scopeDrawn(h.draws), `must draw the scope in ${modeName} mode`).toBe(true);

        // silent again: hides after the empty-poll linger
        h.setParam("__scope", null);
        tick(h.ui, 16);
        h.reset();
        tick(h.ui, 8);
        expect(scopeDrawn(h.draws), "must hide after __scope goes empty").toBe(false);
      });
    }
  }
});

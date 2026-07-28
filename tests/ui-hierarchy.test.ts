import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  flattenKnobs,
  flattenParams,
  paramGroups,
  SHARED_PARAMS_GROUP
} from "../shared/ui-hierarchy.ts";

/**
 * The one walk over ui_hierarchy (shared/ui-hierarchy.ts).
 *
 * Worth testing directly because its output is an *ordering*, and a wrong
 * ordering has no local symptom: the generated C enum, the on-device knob list
 * and the browser's parameter ids are all positional, so a walk that disagrees
 * with the chain host produces a module that builds, validates, renders and
 * addresses the wrong parameters. Nothing in the repo exercises more than one
 * level yet, so these cases are the only coverage the multi-level path has until
 * a module ships with banks.
 */

type P = { key: string };

const p = (key: string): P => ({ key });

describe("flattenParams", () => {
  it("returns nothing for an absent or empty hierarchy", () => {
    expect(flattenParams<P>(undefined)).toEqual([]);
    expect(flattenParams<P>({})).toEqual([]);
    expect(flattenParams<P>({ levels: {} })).toEqual([]);
  });

  it("reads a single root level, the shape every module ships today", () => {
    const params = [p("tune"), p("decay"), p("volume")];
    expect(flattenParams({ levels: { root: { params } } })).toEqual(params);
  });

  it("concatenates levels in declaration order", () => {
    const flat = flattenParams({
      levels: {
        hat: { params: [p("hat_tune"), p("hat_decay")] },
        oh: { params: [p("oh_tune")] },
        kit: { params: [p("volume")] }
      }
    });
    expect(flat.map((item) => item.key)).toEqual(["hat_tune", "hat_decay", "oh_tune", "volume"]);
  });

  /* The invariant the whole multi-level design rests on: grouping parameters into
   * levels is presentation, not structure. Splitting one level into several must
   * not renumber anything, or every preset, golden and browser knob shifts the
   * day a module gains banks. */
  it("orders a split hierarchy identically to the flat one it came from", () => {
    const keys = ["a", "b", "c", "d", "e", "f"];
    const flat = flattenParams({ levels: { root: { params: keys.map(p) } } });
    const split = flattenParams({
      levels: {
        one: { params: keys.slice(0, 2).map(p) },
        two: { params: keys.slice(2, 5).map(p) },
        three: { params: keys.slice(5).map(p) }
      }
    });
    expect(split).toEqual(flat);
  });

  it("puts shared_params first, where the chain host parses them", () => {
    const flat = flattenParams({
      shared_params: [p("shared_a"), p("shared_b")],
      levels: { root: { params: [p("local")] } }
    });
    expect(flat.map((item) => item.key)).toEqual(["shared_a", "shared_b", "local"]);
  });

  it("skips a level that declares no params without consuming an ordinal", () => {
    const flat = flattenParams({
      levels: {
        first: { params: [p("a")] },
        empty: {},
        last: { params: [p("b")] }
      }
    });
    expect(flat.map((item) => item.key)).toEqual(["a", "b"]);
  });
});

describe("integer-like level keys", () => {
  /* Not a style rule. JavaScript enumerates array-index keys first, in numeric
   * order, ahead of every string key — so this object reaches the host as
   * hat, 2, oh and Object.entries as 2, hat, oh. Rejecting it is the only way the
   * two walks cannot disagree. */
  it("would be reordered by the language, so they are rejected", () => {
    expect(Object.keys(JSON.parse(String.raw`{"hat":1,"2":2,"oh":3}`))).toEqual(["2", "hat", "oh"]);
    expect(() => flattenParams({ levels: { hat: { params: [p("a")] }, 2: { params: [p("b")] } } }))
      .toThrow(/integer-like key/);
    expect(() => flattenParams({ levels: { 0: {} } })).toThrow(/integer-like key/);
  });

  it("accepts keys that merely start with a digit, which the language keeps in order", () => {
    /* "01" is not a canonical index and "808cluster" is not numeric, so both stay
     * in insertion order and both are legal level names. */
    expect(Object.keys(JSON.parse(String.raw`{"z":1,"01":2,"808cluster":3}`)))
      .toEqual(["z", "01", "808cluster"]);
    const flat = flattenParams({
      levels: { z: { params: [p("a")] }, "01": { params: [p("b")] }, "808cluster": { params: [p("c")] } }
    });
    expect(flat.map((item) => item.key)).toEqual(["a", "b", "c"]);
  });
});

describe("paramGroups", () => {
  it("carries each level's key and display name", () => {
    const groups = paramGroups({
      levels: {
        hat: { name: "1 Hat", params: [p("hat_tune")] },
        kit: { params: [p("volume")] }
      }
    });
    expect(groups.map((g) => [g.group, g.label])).toEqual([
      ["hat", "1 Hat"],
      ["kit", undefined]
    ]);
  });

  it("labels the shared group so a duplicate key can name where it came from", () => {
    const groups = paramGroups({ shared_params: [p("a")], levels: {} });
    expect(groups.map((g) => g.group)).toEqual([SHARED_PARAMS_GROUP]);
  });

  it("agrees with flattenParams", () => {
    const hierarchy = {
      shared_params: [p("s")],
      levels: { a: { params: [p("x")] }, b: { params: [p("y")] } }
    };
    expect(paramGroups(hierarchy).flatMap((g) => g.params)).toEqual(flattenParams(hierarchy));
  });
});

describe("flattenKnobs", () => {
  it("gathers encoder priority across levels in the same order", () => {
    const knobs = flattenKnobs({
      levels: {
        hat: { knobs: ["hat_tune", "hat_decay"], params: [] },
        kit: { knobs: ["volume"], params: [] }
      }
    });
    expect(knobs).toEqual(["hat_tune", "hat_decay", "volume"]);
  });

  it("is empty when no level declares any", () => {
    expect(flattenKnobs({ levels: { root: { params: [p("a")] } } })).toEqual([]);
  });
});

/* Every module today declares exactly one level called `root`, which is what
 * makes the generated output a free regression test for this change. If that stops
 * being true, the byte-identical-output argument stops holding and this test says
 * so rather than leaving it assumed. */
describe("the modules in the repo", () => {
  it("all declare a single root level and no shared_params", () => {
    const dir = "src/modules";
    const shapes = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => {
        const json = JSON.parse(readFileSync(`${dir}/${entry.name}/module.json`, "utf8"));
        const hierarchy = json.capabilities?.ui_hierarchy;
        return {
          id: entry.name,
          levels: Object.keys(hierarchy?.levels ?? {}),
          shared: (hierarchy?.shared_params ?? []).length
        };
      });
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.levels, shape.id).toEqual(["root"]);
      expect(shape.shared, shape.id).toBe(0);
    }
  });
});

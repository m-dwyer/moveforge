import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  densePresetValues,
  keysDroppedFromPreviousPreset,
  presetValue
} from "../shared/presets.ts";

/**
 * Preset resolution (shared/presets.ts).
 *
 * A preset naming only what it changes is the difference between 64 numbers per kit
 * and 1024 across sixteen of them. The risk it introduces is that "omitted" and
 * "forgotten" look identical in the file, so what is asserted here is mostly the
 * boundary between the two: absent inherits, present-but-not-a-number fails loudly,
 * and dropping a key the previous preset set is reported.
 */

type Param = { default: number; key: string };

const param = (key: string, def: number): Param => ({ key, default: def });

describe("presetValue", () => {
  const tune = param("tune", 36);

  it("takes the declared value when the preset names the key", () => {
    expect(presetValue(tune, { tune: 48 }, "preset X")).toBe(48);
  });

  it("inherits the default when the preset is silent", () => {
    expect(presetValue(tune, {}, "preset X")).toBe(36);
    expect(presetValue(tune, undefined, "preset X")).toBe(36);
    expect(presetValue(tune, { decay: 0.5 }, "preset X")).toBe(36);
  });

  it("keeps an explicit value that happens to equal the default", () => {
    /* Not a distinction the output can carry — the point is that it must not
     * become an error or a special case. */
    expect(presetValue(tune, { tune: 36 }, "preset X")).toBe(36);
  });

  it("keeps 0 and negative values rather than treating them as absent", () => {
    /* `declared[key] ?? default` would be correct here but `||` would not, and
     * this is the case that tells them apart. */
    expect(presetValue(param("drive", 0.3), { drive: 0 }, "preset X")).toBe(0);
    expect(presetValue(param("tone", 0), { tone: -1 }, "preset X")).toBe(-1);
  });

  it("passes an out-of-range value through, because the validator reports it", () => {
    /* Clamping here would hide a preset validate-params wants to complain about,
     * and the generated set_param clamps on the way in anyway. */
    expect(presetValue(tune, { tune: 999 }, "preset X")).toBe(999);
  });

  /* Every one of these is a plausible hand-edit, and every one of them would
   * otherwise reach the C generator or the worklet as a non-number. */
  it("rejects a value that is present but not a finite number", () => {
    for (const bad of ["36", null, true, [], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => presetValue(tune, { tune: bad }, "preset X"), JSON.stringify(bad)).toThrow(
        /not a finite number/
      );
    }
  });

  it("names the preset and the inherited default in that error", () => {
    expect(() => presetValue(tune, { tune: "36" }, "preset Deep Tunnel")).toThrow(
      /preset Deep Tunnel: param tune is "36".*inherit its default of 36/
    );
  });
});

describe("densePresetValues", () => {
  const params = [param("a", 1), param("b", 2), param("c", 3)];

  it("returns every declared param in declaration order", () => {
    expect(densePresetValues(params, { b: 20 }, "preset X")).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 20 },
      { key: "c", value: 3 }
    ]);
  });

  it("is unchanged by a sparse spelling of a dense preset", () => {
    /* The property the whole change rests on: writing out the defaults and leaving
     * them out have to produce the same table, or presets.json cannot be rewritten
     * sparse without re-blessing every golden. */
    const dense = densePresetValues(params, { a: 1, b: 20, c: 3 }, "preset X");
    const sparse = densePresetValues(params, { b: 20 }, "preset X");
    expect(sparse).toEqual(dense);
  });

  it("ignores a key that names no declared param", () => {
    /* validate-params reports it as an error; silently dropping it here keeps the
     * generated table the right length rather than emitting a stray value. */
    expect(densePresetValues(params, { zzz: 9 }, "preset X").map((r) => r.key)).toEqual([
      "a",
      "b",
      "c"
    ]);
  });

  it("resolves an entirely absent params block to all defaults", () => {
    expect(densePresetValues(params, undefined, "preset X").map((r) => r.value)).toEqual([1, 2, 3]);
  });
});

describe("keysDroppedFromPreviousPreset", () => {
  const params = [param("hat_tune", 60), param("conga_tune", 40), param("volume", 0.75)];

  it("reports a key the previous preset set and this one does not", () => {
    const dropped = keysDroppedFromPreviousPreset(
      [
        { name: "Init", params: { hat_tune: 62, conga_tune: 41 } },
        { name: "Deep", params: { hat_tune: 64 } }
      ],
      params
    );
    expect(dropped).toEqual([{ name: "Deep", keys: ["conga_tune"] }]);
  });

  it("says nothing about the first preset, however sparse it is", () => {
    /* `Init` sitting entirely at the defaults is the normal shape, and warning
     * about all 64 of its parameters would make the warning worthless. */
    expect(keysDroppedFromPreviousPreset([{ name: "Init", params: {} }], params)).toEqual([]);
  });

  it("says nothing when a preset adds keys or repeats the same set", () => {
    expect(
      keysDroppedFromPreviousPreset(
        [
          { name: "A", params: { hat_tune: 1 } },
          { name: "B", params: { hat_tune: 2, volume: 0.5 } },
          { name: "C", params: { hat_tune: 3, volume: 0.6 } }
        ],
        params
      )
    ).toEqual([]);
  });

  it("compares against the immediate predecessor, not the union of all presets", () => {
    /* So a key deliberately dropped once is reported once, rather than for every
     * preset after it. */
    const dropped = keysDroppedFromPreviousPreset(
      [
        { name: "A", params: { hat_tune: 1, conga_tune: 2 } },
        { name: "B", params: { hat_tune: 2 } },
        { name: "C", params: { hat_tune: 3 } }
      ],
      params
    );
    expect(dropped).toEqual([{ name: "B", keys: ["conga_tune"] }]);
  });

  it("ignores undeclared keys, which are already a validation error", () => {
    expect(
      keysDroppedFromPreviousPreset(
        [{ name: "A", params: { zzz: 1 } }, { name: "B", params: {} }],
        params
      )
    ).toEqual([]);
  });

  it("reports dropped keys in declaration order", () => {
    const dropped = keysDroppedFromPreviousPreset(
      [
        { name: "A", params: { volume: 0.5, hat_tune: 1, conga_tune: 2 } },
        { name: "B", params: {} }
      ],
      params
    );
    expect(dropped[0].keys).toEqual(["hat_tune", "conga_tune", "volume"]);
  });
});

/* The modules in the repo are all still dense, which is what makes the generated
 * output a regression test for this change. Presets are free to go sparse later —
 * this asserts the reasoning, so it stops holding loudly rather than quietly. */
describe("the presets in the repo", () => {
  it("resolve identically whether their default-valued keys are written or omitted", () => {
    const dir = "src/modules";
    const ids = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const moduleJson = JSON.parse(readFileSync(`${dir}/${id}/module.json`, "utf8"));
      const params: Param[] = moduleJson.capabilities?.ui_hierarchy?.levels?.root?.params ?? [];
      const presets = JSON.parse(readFileSync(`${dir}/${id}/presets.json`, "utf8")).presets ?? [];
      expect(params.length, id).toBeGreaterThan(0);

      for (const preset of presets) {
        const label = `${id} ${preset.name}`;
        const written = densePresetValues(params, preset.params, label);
        const stripped = Object.fromEntries(
          Object.entries(preset.params ?? {}).filter(
            ([key, value]) => params.find((p) => p.key === key)?.default !== value
          )
        );
        expect(densePresetValues(params, stripped, label), label).toEqual(written);
      }
    }
  });
});

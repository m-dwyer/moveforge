import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  definitionGroups,
  definitionKnobs,
  definitionParams,
  parseModuleDefinition
} from "../shared/module-definition.ts";
import { emitSchwungModuleJson } from "../shared/targets/schwung-emit.ts";
import { parseSchwungModuleJson } from "../shared/targets/schwung.ts";
import { flattenKnobs, flattenParams } from "../shared/ui-hierarchy.ts";

const moduleIds = readdirSync("src/modules", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name)
  .sort();

function definitionFor(moduleId: string) {
  const path = `src/modules/${moduleId}/module.def.json`;
  return parseModuleDefinition(JSON.parse(readFileSync(path, "utf8")), path);
}

describe("module definitions", () => {
  it("finds every module", () => {
    expect(moduleIds.length).toBeGreaterThan(0);
  });

  for (const moduleId of moduleIds) {
    describe(moduleId, () => {
      const definition = definitionFor(moduleId);

      /*
       * The one that matters.
       *
       * The browser numbers parameters by their index in definitionParams and
       * sends that index to the worklet. The generated C numbers them by their
       * index in flattenParams over the *emitted* ui_hierarchy. Those are two
       * different code paths over two different shapes, and they have to produce
       * the same order or every knob addresses the wrong parameter — with
       * nothing failing to build.
       *
       * It holds by construction, because the emitter writes one level per group
       * in array order. This asserts it against the real modules anyway, because
       * "by construction" is exactly the kind of claim that stops being true
       * when someone sorts the levels for tidiness.
       */
      it("definition order matches the emitted ui_hierarchy order", () => {
        const emitted = emitSchwungModuleJson(definition);
        const fromDefinition = definitionParams(definition).map((param) => param.key);
        const fromEmitted = flattenParams<{ key: string }>(
          emitted.capabilities.ui_hierarchy as never
        ).map((param) => param.key);
        expect(fromEmitted).toEqual(fromDefinition);
      });

      it("knob assignments survive emission in the same order", () => {
        const emitted = emitSchwungModuleJson(definition);
        expect(flattenKnobs(emitted.capabilities.ui_hierarchy as never)).toEqual(
          definitionKnobs(definition)
        );
      });

      it("emits a module.json the Schwung schema accepts", () => {
        expect(() =>
          parseSchwungModuleJson(emitSchwungModuleJson(definition), moduleId)
        ).not.toThrow();
      });

      it("matches the checked-in module.json", () => {
        const committed = JSON.parse(
          readFileSync(`src/modules/${moduleId}/module.json`, "utf8")
        );
        expect(emitSchwungModuleJson(definition)).toEqual(committed);
      });

      /* Every knob names a parameter of the group that declares it: the device
       * addresses knobs by key within a bank, so a knob naming a parameter from
       * another group is a control that does nothing. */
      it("assigns knobs only to parameters of their own group", () => {
        for (const group of definitionGroups(definition)) {
          const keys = new Set(group.params.map((param) => param.key));
          for (const knob of group.knobs) expect(keys).toContain(knob);
        }
      });
    });
  }
});

describe("param taper", () => {
  it("accepts an exp taper over a range above zero", () => {
    const definition = parseModuleDefinition(
      moduleWithParam({ min: 20, max: 18000, default: 18000, taper: "exp" }),
      "taper-ok"
    );

    expect(definitionParams(definition)[0]?.taper).toBe("exp");
  });

  it("refuses an exp taper over a range that reaches zero", () => {
    /* An exponential taper works by ratio, so a range starting at zero has no
     * ratio to spread the travel over. Caught here rather than left to each
     * host to decide what it means. */
    expect(() =>
      parseModuleDefinition(
        moduleWithParam({ min: 0, max: 1, default: 1, taper: "exp" }),
        "taper-zero"
      )
    ).toThrow(/taper "exp" needs min > 0/);
  });

  it("refuses a taper it does not define", () => {
    expect(() =>
      parseModuleDefinition(
        moduleWithParam({ min: 20, max: 18000, default: 18000, taper: "log" }),
        "taper-unknown"
      )
    ).toThrow();
  });
});

function moduleWithParam(param: Record<string, unknown>) {
  return {
    id: "probe",
    name: "Probe",
    abbrev: "PRB",
    version: "0.1.0",
    description: "Taper probe",
    author: "Local",
    kind: "effect",
    io: {
      audio_in: true,
      audio_out: true,
      midi_in: false,
      note_driven: false,
      midi_out: false
    },
    groups: [
      {
        key: "root",
        name: "Probe",
        params: [{ key: "swept", name: "Swept", type: "float", ...param }],
        knobs: ["swept"]
      }
    ]
  };
}

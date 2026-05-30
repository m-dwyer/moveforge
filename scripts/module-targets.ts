#!/usr/bin/env node
import { argv, exit } from "node:process";
import { selectedModuleIds, selectedModuleTargets, readModuleTarget, type ModuleBuildTarget } from "./lib/modules.ts";

const command = argv[2] ?? "json";

if (command === "ids") {
  for (const id of await selectedModuleIds()) console.log(id);
} else if (command === "json") {
  console.log(JSON.stringify(await selectedModuleTargets(), null, 2));
} else if (command === "field") {
  const moduleId = argv[3];
  const field = argv[4];
  if (!moduleId || !field) {
    console.error("usage: node scripts/module-targets.ts field <module-id> <field>");
    exit(2);
  }
  const target = await readModuleTarget(moduleId);
  const value = fieldValue(target, field);
  if (value === undefined || value === null) exit(1);
  console.log(value);
} else {
  console.error("usage: node scripts/module-targets.ts [ids|json|field <module-id> <field>]");
  exit(2);
}

function fieldValue(target: ModuleBuildTarget, field: string): string | null | undefined {
  switch (field) {
    case "adapterC": return target.paths.adapterC;
    case "componentType": return target.componentType;
    case "coreC": return target.paths.coreC;
    case "coreHeader": return target.paths.coreHeader;
    case "coreImpl": return target.coreImpl;
    case "dspAuthoring": return target.dspAuthoring;
    case "faustC": return target.paths.faustC;
    case "faustDsp": return target.paths.faustDsp;
    case "moduleDir": return target.paths.moduleDir;
    case "moduleJson": return target.paths.moduleJson;
    case "renderBin": return target.renderBin;
    case "renderDemoOut": return target.renderDemoOut;
    case "renderKind": return target.renderKind;
    case "supportsStress": return target.supportsStress ? "1" : "0";
    case "testCoreC": return target.paths.testCoreC;
    case "testPluginC": return target.paths.testPluginC;
    case "wasmGlue": return target.wasmGlue;
    case "wrapperC": return target.paths.wrapperC;
    default: return undefined;
  }
}

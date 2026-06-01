#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { listModuleIds, modulePaths, readModuleTarget, selectedModuleIds } from "./lib/modules.ts";

type Command =
  | "ids"
  | "module-dir"
  | "wrapper-c"
  | "core-header"
  | "faust-c"
  | "test-core-c"
  | "test-plugin-c"
  | "core-impl"
  | "component-type"
  | "render-bin"
  | "render-demo-out"
  | "device-component-dir";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

async function main(args: string[]): Promise<void> {
  const command = args[0] as Command | undefined;
  const moduleId = args[1];

  if (!command) usage();

  if (command === "ids") {
    const ids = process.env.MODULE_ID ? await selectedModuleIds() : await listModuleIds();
    console.log(ids.join(" "));
    return;
  }

  if (!moduleId) usage();

  const paths = modulePaths(moduleId);
  switch (command) {
    case "module-dir":
      console.log(paths.moduleDir);
      return;
    case "wrapper-c":
      console.log(paths.wrapperC);
      return;
    case "core-header":
      console.log(paths.coreHeader);
      return;
    case "faust-c":
      console.log(paths.faustC);
      return;
    case "test-core-c":
      console.log(paths.testCoreC);
      return;
    case "test-plugin-c":
      console.log(paths.testPluginC);
      return;
    case "core-impl":
      console.log((await readModuleTarget(moduleId)).coreImpl);
      return;
    case "component-type":
      console.log((await readModuleTarget(moduleId)).componentType);
      return;
    case "render-bin":
      console.log((await readModuleTarget(moduleId)).renderBin);
      return;
    case "render-demo-out":
      console.log((await readModuleTarget(moduleId)).renderDemoOut);
      return;
    case "device-component-dir": {
      const target = await readModuleTarget(moduleId);
      if (!target.deviceComponentDir) {
        console.error(`unrecognized component_type for ${moduleId}: ${target.componentType}`);
        process.exit(2);
      }
      console.log(target.deviceComponentDir);
      return;
    }
    default:
      usage();
  }
}

function usage(): never {
  console.error(
    "usage: node scripts/module-target.ts <ids|module-dir|wrapper-c|core-header|faust-c|test-core-c|test-plugin-c|core-impl|component-type|render-bin|render-demo-out|device-component-dir> [module-id]"
  );
  process.exit(2);
}

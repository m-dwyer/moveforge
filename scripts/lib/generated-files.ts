import { readFile, writeFile } from "node:fs/promises";

export type GenerateMode = "check" | "write";

export type GenerateOptions = {
  /** Module ids to process. Defaults to MODULE_ID (or all modules) via selectedModuleIds(). */
  moduleIds?: string[];
  /** "write" emits generated files; "check" only reports drift. Defaults to "write". */
  mode?: GenerateMode;
};

export async function writeGeneratedFile(options: {
  generated: string;
  moduleId: string;
  mode: GenerateMode;
  outPath: string;
  staleMessage: string;
  writeMessage: string;
}): Promise<number> {
  const existing = await readFile(options.outPath, "utf8").catch(() => "");

  if (options.mode === "check") {
    if (options.generated !== existing) {
      console.error(`[${options.moduleId}] ${options.outPath} is stale — ${options.staleMessage}`);
      return 1;
    }
    return 0;
  }

  if (existing === options.generated) {
    console.log(`[${options.moduleId}] ${options.outPath} unchanged`);
    return 0;
  }

  await writeFile(options.outPath, options.generated);
  console.log(`[${options.moduleId}] ${options.writeMessage}`);
  return 0;
}

export async function readOptionalFile(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "");
}

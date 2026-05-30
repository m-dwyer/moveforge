import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type TemplateContext = Record<string, string | number | boolean>;

export type RenderedTemplateFile = {
  sourcePath: string;
  targetPath: string;
};

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export async function renderTemplateTree(options: {
  context: TemplateContext;
  dryRun?: boolean;
  sourceDir: string;
  targetForRelativePath: (relativePath: string) => string;
}): Promise<RenderedTemplateFile[]> {
  const rendered: RenderedTemplateFile[] = [];
  for await (const sourcePath of walk(options.sourceDir)) {
    const rel = relative(options.sourceDir, sourcePath);
    const renderedRel = renderTemplateString(rel, options.context);
    const targetPath = options.targetForRelativePath(renderedRel);
    const content = await readFile(sourcePath, "utf8");
    renderTemplateString(content, options.context);
    if (!options.dryRun) {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, renderTemplateString(content, options.context));
    }
    rendered.push({ sourcePath, targetPath });
  }
  return rendered;
}

export function renderTemplateString(input: string, context: TemplateContext): string {
  return input.replace(TOKEN, (_match, key: string) => {
    const value = context[key];
    if (value === undefined) throw new Error(`template references unknown key: ${key}`);
    return String(value);
  });
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

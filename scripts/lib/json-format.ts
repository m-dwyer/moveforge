/**
 * JSON with leaf objects kept on one line.
 *
 * `JSON.stringify(value, null, 2)` puts every property of every object on its
 * own line, which turns a parameter — nine short fields that are read as a unit
 * — into nine lines, and a module with sixty-two of them into a file nobody
 * scans. Eight of the nine hand-written module.json files avoided that by
 * keeping each param on one line, and that is the shape worth preserving now
 * that the authored file is `module.def.json`.
 *
 * The rule is deliberately mechanical rather than a list of known keys: an
 * object or array whose own values are all primitives goes on one line if it
 * fits `maxWidth`, and is expanded otherwise. So a parameter collapses, a
 * `groups` entry containing a `params` array does not, and a long `description`
 * expands on its own rather than pushing a line past the margin.
 */
export type JsonFormatOptions = {
  indent?: number;
  maxWidth?: number;
};

const DEFAULT_INDENT = 2;
const DEFAULT_MAX_WIDTH = 150;

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

/** True when every own value is a primitive, so the whole thing can sit on one line. */
function isLeaf(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isPrimitive);
  if (value !== null && typeof value === "object") return Object.values(value).every(isPrimitive);
  return false;
}

export function formatJson(value: unknown, options: JsonFormatOptions = {}): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;

  const render = (node: unknown, depth: number): string => {
    if (isPrimitive(node)) return JSON.stringify(node) ?? "null";

    const pad = " ".repeat(indent * depth);
    const innerPad = " ".repeat(indent * (depth + 1));

    if (isLeaf(node)) {
      const oneLine = Array.isArray(node)
        ? `[${node.map((v) => JSON.stringify(v)).join(", ")}]`
        : `{ ${Object.entries(node as object)
            .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
            .join(", ")} }`;
      if (pad.length + oneLine.length <= maxWidth) return oneLine;
    }

    if (Array.isArray(node)) {
      if (node.length === 0) return "[]";
      const items = node.map((item) => `${innerPad}${render(item, depth + 1)}`);
      return `[\n${items.join(",\n")}\n${pad}]`;
    }

    const entries = Object.entries(node as object).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const rendered = entries.map(
      ([key, item]) => `${innerPad}${JSON.stringify(key)}: ${render(item, depth + 1)}`
    );
    return `{\n${rendered.join(",\n")}\n${pad}}`;
  };

  return `${render(value, 0)}\n`;
}

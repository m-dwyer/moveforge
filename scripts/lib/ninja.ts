/**
 * A minimal ninja build-file writer.
 *
 * Ninja is deliberately not meant to be written by hand — it is the assembly
 * language a generator emits, which is why this exists rather than a checked-in
 * build.ninja. Everything the build needs to know about modules lives in
 * module.json and scripts/lib/modules.ts; this turns that into edges.
 *
 * The only ninja semantics that matter here:
 *   - `deps = gcc` + `depfile` makes ninja parse the compiler's own -MMD output,
 *     so a header edit rebuilds exactly what included it. That is the thing the
 *     hand-maintained dependency arrays in the old bash could not get right.
 *   - `builddir` is where ninja keeps .ninja_log/.ninja_deps. Each generated file
 *     sets its own, so three build files can share a working directory (and
 *     therefore share root-relative paths) without trampling each other's state.
 */

export type BuildEdge = {
  outputs: string[];
  rule: string;
  inputs?: string[];
  /** Order-only prerequisites: must exist, but do not trigger a rebuild. */
  orderOnly?: string[];
  /** Per-edge variable bindings, indented under the edge. */
  variables?: Record<string, string | undefined>;
};

export class NinjaWriter {
  #lines: string[] = [];
  #declaredOutputs = new Set<string>();

  constructor(header: string, builddir: string) {
    this.#lines.push(
      ...header
        .trim()
        .split("\n")
        .map((line) => (line ? `# ${line}` : "#")),
      "",
      "ninja_required_version = 1.10",
      `builddir = ${escapePath(builddir)}`,
      ""
    );
  }

  comment(text: string): void {
    this.#lines.push(...text.trim().split("\n").map((line) => (line ? `# ${line}` : "#")), "");
  }

  variable(name: string, value: string): void {
    this.#lines.push(`${name} = ${escapeValue(value)}`);
  }

  /**
   * Declare a rule. Bindings are written verbatim: a rule body is the one place
   * where `$out`, `$in` and `$cflags` are deliberate ninja references rather than
   * literal text, so escaping `$` here would break every command.
   */
  rule(name: string, bindings: Record<string, string>): void {
    this.#lines.push(`rule ${name}`);
    for (const [key, value] of Object.entries(bindings)) {
      this.#lines.push(`  ${key} = ${value}`);
    }
    this.#lines.push("");
  }

  /**
   * Emit a build edge, or skip it if its output was already declared.
   *
   * Deduplication is load-bearing, not defensive: a module's core object is an
   * input to both test_<id>_core and test_<id>_plugin with identical flags, so
   * both targets legitimately ask for the same .o. Ninja treats a second edge
   * producing an existing output as a hard error, so the generator has to be the
   * thing that notices they are the same build.
   */
  build(edge: BuildEdge): boolean {
    if (edge.outputs.some((output) => this.#declaredOutputs.has(output))) return false;
    for (const output of edge.outputs) this.#declaredOutputs.add(output);

    const outputs = edge.outputs.map(escapePath).join(" ");
    const inputs = (edge.inputs ?? []).map(escapePath);
    const orderOnly = (edge.orderOnly ?? []).map(escapePath);
    const tail = orderOnly.length > 0 ? ` | ${orderOnly.join(" ")}` : "";

    this.#lines.push(`build ${outputs}: ${edge.rule} ${inputs.join(" ")}${tail}`.trimEnd());
    for (const [key, value] of Object.entries(edge.variables ?? {})) {
      if (value === undefined || value === "") continue;
      this.#lines.push(`  ${key} = ${escapeValue(value)}`);
    }
    return true;
  }

  phony(name: string, inputs: string[]): void {
    this.#lines.push("", `build ${escapePath(name)}: phony ${inputs.map(escapePath).join(" ")}`);
  }

  default_(targets: string[]): void {
    this.#lines.push("", `default ${targets.map(escapePath).join(" ")}`);
  }

  toString(): string {
    return `${this.#lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
  }
}

/**
 * Escape a path for a build edge. Ninja splits edges on unescaped spaces and
 * colons, and treats `$` as a variable sigil.
 */
export function escapePath(path: string): string {
  return path.replace(/\$/g, "$$").replace(/ /g, "$ ").replace(/:/g, "$:");
}

/** Escape a variable value. Only `$` is special once past the `=`. */
export function escapeValue(value: string): string {
  return value.replace(/\$/g, "$$");
}

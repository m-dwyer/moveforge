import { Eta } from "eta";

/**
 * eta rendering for the generated-file templates in templates/generated/.
 *
 * Why eta here and the {{token}} replacer (lib/templates.ts) there: these
 * templates emit repetitive per-param C, and a token replacer can only
 * substitute an already-finished string. That pushed the shape of the emitted C
 * out of the template and into .map().join() calls in the generators, so
 * neither file told you on its own what came out — params.gen.inc.tmpl showed a
 * `switch` but not what a case looked like. Two artifacts had given up on
 * templates entirely and were built by joining string arrays.
 *
 * lib/templates.ts keeps templates/modules/: that tree templates *filenames*
 * across a scaffold and wants dumb substitution, not loops.
 *
 * autoEscape is off because the output is C and JavaScript, not HTML — eta's
 * HTML escaping would corrupt every string literal it touched.
 */
const eta = new Eta({ autoEscape: false, autoTrim: false, views: "templates/generated" });

/**
 * Reject reads of keys the context does not define.
 *
 * The token replacer threw on an unknown key; eta on its own writes the string
 * "undefined" into the output and carries on. In a .gen.inc that is either a
 * compile error a long way from its cause, or — where the token sits in a
 * comment or a name — a silently wrong generated file that the drift check will
 * then happily bless. Symbols are passed through untouched: eta and the runtime
 * probe for things like Symbol.toPrimitive, and those are not typos.
 */
function strict<T extends object>(data: T): T {
  return new Proxy(data, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || key in target) return Reflect.get(target, key, receiver);
      throw new Error(`template references unknown key: ${String(key)}`);
    }
  });
}

/**
 * Render templates/generated/<name>.eta. Throws if the template reads a key the
 * context lacks.
 *
 * The extension is appended here rather than left to eta's defaultExtension:
 * these names already carry dots (`params.gen.h`), and eta reads the trailing
 * `.h` as the extension and resolves a file that does not exist.
 */
export function renderGenerated(name: string, context: object): string {
  return eta.render(`${name}.eta`, strict(context));
}

/*
 * The one walk over `capabilities.ui_hierarchy`.
 *
 * Six places used to read `levels.root.params` directly — gen-params,
 * gen-presets, gen-ui-chain (twice), render-stress, validate-params and the
 * browser's module-metadata. That is fine while every module declares exactly one
 * level called `root`, and silently wrong the moment one declares more: the host
 * registers every parameter in every level, so anything outside `root` becomes a
 * knob the host offers and the module does not answer to. No local symptom, no
 * failing build — just dead controls on the device.
 *
 * It has to be *one* helper rather than six corrected copies because the order is
 * load-bearing in two directions at once. `web/src/module-metadata.ts` sends the
 * array index to the worklet as a parameter id, and that index has to equal the
 * ordinal of the generated `<MODULE>_PARAM_*` enum. Two walks that drift give you
 * a browser whose knobs address the wrong parameters, in one of three build
 * targets, with everything still compiling.
 *
 * Order, matching what the chain host does (schwung 0.11.4,
 * src/modules/chain/dsp/chain_params.c:439 `parse_hierarchy_params`):
 *
 *   1. `shared_params`, which it parses first (:447) — before it has looked at
 *      `levels` at all (:493). Nothing in this repo uses shared_params yet; the
 *      order is encoded here so whoever adds it inherits the host's answer rather
 *      than discovering it.
 *   2. Each level's `params`, levels in declaration order.
 *
 * "Declaration order" means order in the JSON *text*: the host finds each level by
 * scanning brace to brace. JavaScript agrees for ordinary keys and disagrees for
 * one family of them — see `assertWalkableLevelKeys`.
 *
 * Known limit: a module.json with the same level key twice would have both copies
 * parsed by the host and only the last kept by JSON.parse. Detecting that needs
 * the raw text, which this helper deliberately does not take.
 */

/* Generic over the parameter shape on purpose. Every caller already has its own
 * `Param` type with exactly the fields it cares about — the generators need
 * `default` and `step`, the validator needs `name`, the browser needs neither —
 * and this file has no business being the union of all of them. It orders
 * parameters; it does not describe them. */
export type UiHierarchyLevel<P> = {
  knobs?: string[];
  name?: string;
  params?: P[];
};

export type UiHierarchy<P> = {
  levels?: Record<string, UiHierarchyLevel<P> | undefined>;
  shared_params?: P[];
};

export type ParamGroup<P> = {
  /* The key under `levels`, or SHARED_PARAMS_GROUP. */
  group: string;
  /* The level's declared display `name`, when it has one. This is what a bank
   * label on the device reads from, and it is deliberately allowed to disagree
   * with `group`: "1 Hat" is a label, `hat` is a key. */
  label?: string;
  params: P[];
  knobs: string[];
};

export const SHARED_PARAMS_GROUP = "shared_params";

/* Parameters grouped by the level that declared them, in host order.
 *
 * This is the primitive; `flattenParams` is defined in terms of it so a caller
 * that wants group structure (bank names on the Move, group headers in the
 * browser) cannot end up walking the hierarchy a second, differently-ordered
 * time to get it. */
export function paramGroups<P>(hierarchy: UiHierarchy<P> | undefined): ParamGroup<P>[] {
  if (!hierarchy) return [];

  const groups: ParamGroup<P>[] = [];
  const shared = hierarchy.shared_params ?? [];
  if (shared.length > 0) {
    groups.push({ group: SHARED_PARAMS_GROUP, params: shared, knobs: [] });
  }

  const levels = hierarchy.levels ?? {};
  assertWalkableLevelKeys(Object.keys(levels));
  for (const [group, level] of Object.entries(levels)) {
    if (!level) continue;
    groups.push({
      group,
      label: level.name,
      params: level.params ?? [],
      knobs: level.knobs ?? []
    });
  }
  return groups;
}

/* Every declared parameter, in the order the host registers them — which is the
 * order the generated enum counts in, and therefore the order the browser's
 * parameter ids have to follow. */
export function flattenParams<P>(hierarchy: UiHierarchy<P> | undefined): P[] {
  return paramGroups(hierarchy).flatMap((group) => group.params);
}

/* Encoder priority, gathered across levels in the same order. Keys, not indices —
 * resolving them against `flattenParams` is the caller's job, because a key that
 * matches no parameter is an error in the validator and a skip in the generator. */
export function flattenKnobs<P>(hierarchy: UiHierarchy<P> | undefined): string[] {
  return paramGroups(hierarchy).flatMap((group) => group.knobs);
}

/* Reject level keys that JavaScript would hand back in a different order than the
 * host reads them in.
 *
 * Integer-like keys are not stored in insertion order: they enumerate first, in
 * ascending numeric order, ahead of every string key. So
 * `{"hat": …, "2": …, "oh": …, "1": …}` reaches the host as hat, 2, oh, 1 and
 * reaches `Object.entries` as 1, 2, hat, oh — every parameter ordinal after the
 * first level shifts, and nothing anywhere reports it.
 *
 * The test is exactly the keys the language treats as array indices, so a level
 * called `808cluster` (or `01`, which is not canonical) is fine. Numbering belongs
 * in the level's `name`, where it is a label rather than an ordering. */
function assertWalkableLevelKeys(keys: string[]): void {
  const indexLike = keys.filter(isArrayIndexKey);
  if (indexLike.length === 0) return;
  throw new Error(
    `ui_hierarchy.levels has integer-like key(s) ${indexLike.map((k) => `"${k}"`).join(", ")}. ` +
      `JavaScript enumerates those before every other key, so this walk and the chain host's ` +
      `would disagree on parameter order and the ids would silently point at the wrong ` +
      `parameters. Name the level and put the number in its "name".`
  );
}

function isArrayIndexKey(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key) && Number(key) <= 4294967294;
}

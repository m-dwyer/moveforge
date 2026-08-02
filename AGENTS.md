# moveforge

A local development harness for building custom [Schwung](https://github.com/charlesvestal/schwung)
modules for Ableton Move — sound generators, audio FX and MIDI FX. Each module
builds three ways from one source: an aarch64 `.so` for the device, a host
binary for offline WAV/trace rendering, and WASM for the browser UI.

Schwung is unofficial and device deployment is experimental. Prefer local
render, host and WASM checks before copying anything to hardware.

## Layout

```
src/modules/<id>/       one self-contained module (see below)
src/modules/_shared/    shared C helpers — mf_dsp.h, dsp_runtime.h, scope.h
src/host/               local copies of the Schwung ABIs (drifted; see below)
web/                    browser UI: React + Vite + Tailwind + shadcn
shared/                 TypeScript the generators and the browser both need
tools/                  offline harnesses — render_wav.c, render_fx.c, trace_midi_fx.c
tests/                  C tests: test_<id>_core.c, test_<id>_plugin.c, test_mf_dsp.c
scripts/                build, codegen and validation (TypeScript; shell for SSH/device)
build/                  GENERATED {host,move,wasm}.ninja + objects — not checked in
templates/              scaffolds for new modules, and the codegen templates
goldens/                blessed render metrics per module
plans/                  working documents for in-flight work
```

A module directory, plain C on the left, Faust on the right:

```
module.def.json         SINGLE SOURCE OF TRUTH: metadata + parameter schema
module.json             GENERATED for the Schwung target from module.def.json
presets.json            presets, and the render-suite clips
metadata.json           randomize ranges
ui.js                   on-device solo screen
ui_chain.js             GENERATED chain-mode UI
dsp/<id>.c              Schwung wrapper (one per component_type)
dsp/<id>_core.h         public API contract — identical shape either way
dsp/<id>_core.c           |  dsp/<id>.dsp        Faust source (canonical)
                          |  dsp/<id>_faust.c    GENERATED from it, checked in
                          |  dsp/<id>_adapter.c  bridges Faust to the contract
dsp/<id>_params.gen.h   GENERATED: param count + enum, included by _core.h
dsp/<id>_params.gen.inc GENERATED: param id/get/set/defaults
dsp/<id>_presets.gen.inc GENERATED from presets.json
```

The C build is generated, not hand-maintained: `scripts/gen-ninja.ts` walks the
module graph and emits `build/{host,move,wasm}.ninja`, which **ninja** then runs.
Every build and test task regenerates the ninja files first, so adding a module
or a parameter never needs a separate `mise run gen-ninja`. Faust is detected
purely by the presence of `<id>.dsp` — no flag, no config — and that one check
decides the sources for all three targets at once. Faust is the default for new
sound generators and audio FX; MIDI FX are always plain C.

## Rules that prevent silent breakage

1. **`module.def.json` is the single source of truth** for metadata and the
   parameter schema. Params, their ranges and defaults are declared there and
   nowhere else — the C, the on-device UI and the browser all derive from it.
   `module.json` is **generated** from it for the Schwung target
   (`mise run gen-module-json`); edit the definition, never the output.
   They derive through `shared/ui-hierarchy.ts`, which is the **only** place that
   walks `ui_hierarchy` — parameter *order* is an ABI between the generated enum,
   the device's knob list and the browser's parameter ids, so a second walk that
   disagrees is a module addressing the wrong parameters with nothing failing.
   Its other half is `shared/module-schema.ts`, the **only** place that describes
   what those files *contain*: ui-hierarchy says what order parameters come in,
   module-schema says what a parameter is. Read them through
   `readModuleDefinition` / `readModuleJson` / `readPresetsJson` /
   `readMetadataJson` in `scripts/lib/modules.ts` rather than
   `JSON.parse(...) as T` — eight files used to declare their own `ModuleJson`,
   each a different subset, so a field one generator relied on was checked by
   none of the others. Three call sites have not been converted yet and are the
   places a malformed file still surfaces as a `TypeError` rather than a message
   naming the field: `scripts/render-suite.ts:91`, `scripts/check-renders.ts:374`
   and `scripts/new-module.ts:194` (the last reads `index.json`, for which
   `moduleIndexSchema` already exists).

   That description is **layered, and the layering is the point**.
   `shared/module-schema.ts` is target-agnostic: a module is parameters with
   musical semantics — key, name, type, range, step, unit. It knows about no
   host. Everything host-shaped lives in a target under `shared/targets/`, and
   the only one today is `schwung.ts`: the `module.json` layout, `capabilities`,
   `ui_hierarchy`, `abbrev`, `display_format`, and the host's fixed buffers. The
   test for where a field goes is whether it exists only because something reads
   a file at runtime — `api_version` and `dsp: "dsp.so"` do, `unit` does not. A
   future CLAP or VST target emits a C descriptor table and no manifest at all,
   and must inherit none of schwung's constraints.

   Schemas own what is intrinsic to one object (field types, ranges, enums);
   anything relational — duplicate keys, host byte limits, preset values against
   their param's range, and every check that reads the C or the `.dsp` — stays in
   `scripts/validate-params.ts`, which carries the upstream citations for it.
2. **Never hand-edit a generated file.** Anything named `*.gen.*`, plus
   `module.json`, `ui_chain.js` and `<id>_faust.c`. Edit the source and re-run the generator;
   `mise run validate` fails on drift. There are two template systems, split
   along a real seam: `templates/generated/*.eta` emit repetitive code from data
   (loops and conditionals, rendered via `scripts/lib/eta.ts`) — four of the five
   emit C, and `ui_chain.js.eta` emits the on-device JavaScript — while
   `templates/modules/` is the scaffold tree, where `scripts/lib/templates.ts`
   does dumb `{{token}}` substitution over file *contents and filenames* and
   throws on an unknown key. Both reject a typo'd key rather than writing
   `undefined` into a generated file.
3. **Run tasks via `mise run ...`, not the scripts directly.** Most call bare
   `node` or `ninja`, neither of which is on `PATH` outside mise. Task names
   follow a shape: `<thing>-build` produces an artifact (`host-build`,
   `move-build`, `wasm-build`), `test-<thing>` runs a suite (`test-c`,
   `test-c-san`, `test-web`, `test-ui-chain`), `move-<verb>` acts on the device
   (`move-install`, `move-deploy`, `move-health`).
4. **`mise run check` is the gate.** It must exit 0 before anything ships.
   Module-aware tasks run for every module unless you set `MODULE_ID=<id>`.
   `check` leaves out `test-web`, which needs a Playwright browser download —
   but it does run `web-build`, so a broken vite config or web TypeScript fails
   locally. `test-web` is gated in CI in its own job, and `mise run test` is the
   local umbrella that includes it.

   Three things `check` does **not** cover, so a green local gate is not a green
   CI. Two of them CI does; the third is nobody's:
   - **Leaks.** LeakSanitizer ships with ASan on Linux and does not exist under
     Apple clang, so `test-c-san` on a Mac is a weaker test than the same task
     on the runner — this let three Faust core tests leak with `check` green.
     `mise run test-c-linux` runs the sanitizer pass in a Linux container.
   - **The aarch64 build.** `check` never cross-compiles. The CI `device-build`
     job runs `move-build` and verifies each `dsp.so` exports a Schwung entry
     point; locally that is `mise run move-build`.
   - **`format-check` and `check-gcc`** are in neither `check` nor CI. `check-gcc`
     exists because Apple clang does not implement `-Wformat-truncation`, so run
     it by hand before a C-heavy change.

Keep musical DSP behaviour in the shared core, not in the wrappers, the web
code or the render tools — there are three build targets and only one of them
is easy to listen to.

## Creating a module, adding a parameter

```bash
pnpm run new-module -- --id <id> --kind sound_generator|audio_fx|midi_fx
```

This scaffolds from `templates/modules/`, runs every generator, and registers
the module in `src/modules/index.json`.

Adding a parameter touches `module.def.json`, the core struct or the `.dsp`, and
then the generators. **`skills/schwung-dsp-development/SKILL.md` is the
canonical step-by-step** for both — follow it rather than reconstructing the
order, because the generators have to run in sequence (`gen-module-json` first,
since the rest read its output) and `validate` checks all five for drift.

## Where to look next

| for | read |
|---|---|
| module authoring, the dev loop, the Faust vs plain-C decision | `skills/schwung-dsp-development/SKILL.md` |
| designing a module's controls before writing DSP | `skills/module-architect/SKILL.md` |
| whether a module's knobs and presets actually do anything | `skills/sonic-reviewer/SKILL.md` |
| whether two controls fight, or one is only changing loudness | `skills/control-interaction/SKILL.md` |
| what a module actually *sounds* like, and whether its knobs do anything | `mise run palette` |
| what each module is and does | `MODULES.md` |
| how the pieces fit together, and why | `docs/architecture.md` |
| commands, the web UI, device deploy | `README.md` |
| what a good module *sounds* like, and real-time safety | `docs/module-design.md` |
| in-flight work and known gaps | `plans/` |

`src/host/*.h` are local copies of the Schwung ABIs. Checked against upstream
`a20cacd1` / v0.11.4 they are **not** currently drifted — `plugin_api_v1.h` is
byte-identical, `audio_fx_api_v2.h` differs only in comments, and
`midi_fx_api_v1.h` matches in layout, differing in include-guard and macro names
(`MOVE_`-prefixed here). Re-check after any upstream bump.

Upstream's `MIDI_FX_MAX_OUT_MSGS 16` used to be missing from that copy, so both
harnesses invented their own MIDI FX output budget and neither matched the device
— the offline trace passed 8 and the browser passed 32. It is now
`MOVE_MIDI_FX_MAX_OUT_MSGS`, and nothing calling `process_midi` or `tick` should
define its own.

For any question about actual host behaviour — parameter limits, when `set_param`
is called, how presets and chain UIs are loaded — read the upstream source rather
than trusting the copies or the docs. It lives in a gitignored checkout at
`upstream/schwung` (override with `$UPSTREAM_DIR`) — clone Schwung there yourself,
then keep it current with `scripts/update-upstream-schwung.sh`, which only
refreshes an existing checkout. There is also a checkout at
`../overture/schwung`, pinned as a submodule of the Overture groovebox. The parts worth knowing are
`src/modules/chain/dsp/` (the chain host and its `module.json` parser) and
`src/shadow/` (the on-device UI runtime).

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
tools/                  offline harnesses — render_wav.c, render_fx.c, trace_midi_fx.c
tests/                  C tests: test_<id>_core.c, test_<id>_plugin.c, test_mf_dsp.c
scripts/                build, codegen and validation (TypeScript + shell)
templates/              scaffolds for new modules, and the codegen templates
goldens/                blessed render metrics per module
plans/                  working documents for in-flight work
```

A module directory, plain C on the left, Faust on the right:

```
module.json             SINGLE SOURCE OF TRUTH: metadata + parameter schema
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

Build scripts detect Faust purely by the presence of `<id>.dsp`. No flag, no
config. Faust is the default for new sound generators and audio FX; MIDI FX are
always plain C.

## Rules that prevent silent breakage

1. **`module.json` is the single source of truth** for metadata and the
   parameter schema. Params, their ranges and defaults are declared there and
   nowhere else — the C, the on-device UI and the browser all derive from it.
2. **Never hand-edit a generated file.** Anything named `*.gen.*`, plus
   `ui_chain.js` and `<id>_faust.c`. Edit the source and re-run the generator;
   `mise run validate` fails on drift.
3. **Run tasks via `mise run ...`, not the scripts directly.** Most call bare
   `node`, which is not on `PATH` outside mise.
4. **`mise run check` is the gate.** It must exit 0 before anything ships.
   Module-aware tasks run for every module unless you set `MODULE_ID=<id>`.

Keep musical DSP behaviour in the shared core, not in the wrappers, the web
code or the render tools — there are three build targets and only one of them
is easy to listen to.

## Creating a module, adding a parameter

```bash
pnpm run new-module -- --id <id> --kind sound_generator|audio_fx|midi_fx
```

This scaffolds from `templates/modules/`, runs every generator, and registers
the module in `src/modules/index.json`.

Adding a parameter touches `module.json`, the core struct or the `.dsp`, and
then the generators. **`skills/schwung-dsp-development/SKILL.md` is the
canonical step-by-step** for both — follow it rather than reconstructing the
order, because the generators have to run in sequence and `validate` checks all
four for drift.

## Where to look next

| for | read |
|---|---|
| module authoring, the dev loop, the Faust vs plain-C decision | `skills/schwung-dsp-development/SKILL.md` |
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

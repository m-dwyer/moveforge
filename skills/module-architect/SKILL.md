---
name: module-architect
description: Turn a sonic brief into a moveforge module design — signal flow, parameter set, hardware knob assignment, failure modes, and an evaluation plan — before any DSP is written. Use when the user describes a sound or an instrument they want ("a kick engine", "something like a Benjolin", "a resonator FX") and there is no module yet, or when an existing module's parameter surface needs rethinking rather than debugging. Trigger on "design a module", "what parameters should this have", "how should I lay this out", "is this the right control set". Not for implementing DSP — that is schwung-dsp-development.
---

# Module Architect

Turn "I want a sound like X" into a design a module can be built from. This is
the step before `pnpm run new-module`, and it is where the expensive mistakes
are cheap to fix: a parameter set is a few lines of `module.def.json` now and an
ABI plus goldens plus a device layout later.

**Design, don't implement.** The output is a written design the user agrees to.
Once they do, `skills/schwung-dsp-development/SKILL.md` takes over.

## Read first

- `docs/module-design.md` — what a good module sounds like, and the real-time
  constraints that shape it
- `MODULES.md` — what already exists, so a proposal is not a fifth subtractive
  voice
- `docs/roadmap.md` — the catalogue gaps already identified
- The closest existing module's `module.def.json`, for the shape of a real
  parameter set

Do not re-derive these.

## The output

Nine sections. Keep it short enough to read in one sitting.

1. **Identity.** One sentence: what this is and what job it does in a track. If
   it takes a paragraph, the module is two modules.
2. **Non-goals.** What it deliberately will not do. This is what stops the
   parameter list growing forever.
3. **Signal flow.** A diagram, source to output. Name each stage.
4. **Parameters.** For each: key, display name, type, range, default, step, and
   `unit`. State what it does *audibly* — "how long a hit lasts" beats "decay
   coefficient of the amplitude envelope".
5. **Knob assignment.** Which parameters get the eight hardware encoders, in
   order, per group. If there are more than eight, say which group each bank
   belongs to.
6. **Hidden parameters.** Things the DSP needs that should not be controls.
   Say why each is hidden — usually "no musical range" or "only useful with
   another parameter".
7. **Happy accidents.** Settings you expect to be surprising and good. These
   become presets.
8. **Failure modes.** Settings you expect to be bad, and whether they should be
   reachable. A module with no bad settings usually has no range.
9. **Evaluation.** Which presets prove it works, and what the note map should
   contain if it is note-mapped.

## Rules that come from this repo, not from taste

**Parameter order is an ABI.** It ties the generated C enum, the device knob
list and the browser's parameter ids together. Design the order deliberately;
reordering later is not free.

**A control with `step >= 1` is discrete.** Give it `type: "int"` or `"enum"`,
never `"float"` — a float gets smoothed on the audio thread and will ramp
through every intermediate setting on the way.

**Give every parameter a `unit`.** `%` for a normalised 0..1 control, `sec`,
`ms`, `Hz`, `dB`, `st` where the number is real. Without one the device shows a
bare float. Leave it off only when the number genuinely has no unit — a MIDI
note, a ratio, a selector index.

**Sound generators need a `volume` or `level` with `min: 0`**, so the stress
renders can prove silence is reachable.

**Eight encoders per group.** More parameters than that is fine; it means more
than one group, and groups are how banks are organised.

## Before proposing macros

Move has eight encoders per group and `ui_hierarchy` groups for depth, so a
macro layer is a *different* answer to the same problem, not a free addition —
it would need C-side evaluation, host UI support and preset storage. Propose
grouped parameters first. Only raise macros if the design genuinely wants one
control to move several parameters along a curve, and say what it would cost.

## Do not

- Propose a DSP graph in TypeScript or JSON. DSP is Faust or C, hand-authored.
- Propose parameters whose only difference is scaling of the same quantity.
- Claim how something will sound. You have not heard it. Say what you intend and
  how it will be checked — `mise run palette` is what answers it, and
  `skills/sonic-reviewer/SKILL.md` reads that output.

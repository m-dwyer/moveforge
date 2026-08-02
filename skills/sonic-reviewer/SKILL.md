---
name: sonic-reviewer
description: Review what a moveforge module actually sounds like, from the evidence `mise run palette` produces — whether its knobs do anything, whether its presets differ, whether it has range and usable sweet spots. Use when the user asks "is this any good", "does this knob do anything", "why does this sound the same everywhere", "review this module", or after a DSP change lands and before blessing goldens. Trigger on "audition", "palette", "sonic review", "does this work musically". Not for correctness or crashes — that is diagnosing-bugs.
---

# Sonic Reviewer

Answer "is this module any good" from measurements, not from reading the DSP.
The render suite and stress gates already answer "did this change" and "is it
safe". Neither can tell you a control is inert or that six presets are the same
patch, and both of those have shipped here green.

## Get the evidence first

```bash
MODULE_ID=<id> mise run palette
```

Writes `renders/palette/<id>/palette.md` — fixed-width tables meant to be read
whole — and `palette.html`, which carries the audio and a spectrum per row. The
report depends on `render`, so it builds against current DSP rather than
whatever binary was lying around.

**Do not review without it.** A review written from the source is a review of
the intent, not the module.

## What the report contains

**`## Note map`** (or `## Default voice`) — one hit per note from `root` up, so a
note-mapped drum module's voices can be heard apart. Columns are `peak`, `T60`,
`centroid` and the spectral descriptors. A silent note here is usually a group
with no voice, not a bug.

**`## Knob travel`** — every parameter swept min→max, reporting how far the sound
actually moved: `centroid` (octaves), `length`, `flat`, `level`, `width`,
`bright`. Knobs with no audible travel are counted and listed. The threshold is
deliberately generous — a false "dead" is worse than a missed one — so a knob it
flags is worth believing.

**`## Presets`** — the same fingerprint per preset, so "these presets make no
sense" becomes a table.

## What to ask of it

- **Does every control earn its place?** Start from the dead list. For each,
  decide: genuinely inert, only audible in combination with another parameter,
  or swept on the wrong voice. The third is a report artifact — a per-voice
  control swept while listening to a different voice reads as dead.
- **Is the range real?** A parameter whose travel is under a tenth of an octave
  of centroid and no change in length is a trim, not a control. Say so.
- **Do the presets differ?** Two presets with near-identical fingerprints are one
  preset. Presets are also the render suite's clips, so duplicates cost goldens
  and CI time for no coverage.
- **Is there a sweet spot, and how wide?** A module usable only at one setting
  is a sample.
- **Does it translate?** Low-end weight that vanishes on small speakers, or
  brightness that turns harsh, both show in `centroid` and `bright`.
- **Is it interesting at the extremes?** Ranges nobody would use are wasted
  travel on an encoder.
- **Does it overlap the catalogue?** Check `MODULES.md`. Two modules that make
  the same sound are one module and a preset.

## Rules for the review itself

**Separate observed, inferred and unknown.** "The `grit` sweep moves centroid by
0.08 octaves" is observed. "So it is probably a trim on a fixed filter" is
inferred. "Whether it interacts with `mat`" is unknown until swept together.
Label them. Most bad reviews are inferences written as observations.

**Never claim a quality judgement you have no evidence for.** You cannot hear
the audio. You can read descriptors, and you can say what they imply. If the
question needs ears, say so and point the user at `palette.html`.

**A metric is not a verdict.** `flatness` separates a wash from a bell; it does
not say which one the module should be. Only the module's own design says that
— `docs/module-design.md` and the module's brief in `plans/`.

**Propose experiments, not opinions.** "Sweep `tone` at `mat` 0 and 1 and
compare" is actionable. "The tone control feels weak" is not.

## Output

A short written review, then a table of specific findings: control, what was
measured, what it implies, and the cheapest experiment that would settle it.
Rank by how much the module improves if you are right.

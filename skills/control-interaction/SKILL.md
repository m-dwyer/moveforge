---
name: control-interaction
description: Investigate how a moveforge module's controls behave together — whether one is only changing loudness, whether two fight or cancel, whether a knob that reads dead is actually conditional on another. Use when the user says two controls interfere, a knob "just makes it louder", a control seems dead but shouldn't be, or a sonic review flagged something that a single-parameter sweep cannot settle. Trigger on "these fight each other", "only changes volume", "does nothing unless", "why is this knob dead". Requires paired renders, not just `mise run palette`.
---

# Control Interaction

`mise run palette` sweeps one parameter at a time from the module's defaults.
That is the right default and it answers most questions, but it is blind to
three failures by construction:

- a control that only moves **level**, which reads as travel but is not character
- two controls that **cancel**, so each looks fine alone and neither does
  anything in combination
- a control that is **conditional** — inert at the default of another parameter
  and alive elsewhere, which the report calls dead

This skill is for those. It exists separately from `sonic-reviewer` because it
needs evidence that report does not contain.

## Get the evidence

Build the harness, then render a small grid yourself:

```bash
MODULE_ID=<id> mise run render-build
```

The binary is `./build/render_wav_<id>` for a sound generator,
`./build/render_fx_<id>` for an audio FX. Its render form is:

```
<bin> --render <out.wav> <seconds> <note_blocks> <gate_blocks> <velocity> <pattern> key=value ...
```

`pattern` is sixteen comma-separated note slots — `"36,,,,,,,,,,,,,,,"` plays one
note. Every parameter you do not name takes its declared default, so name both
axes explicitly:

```bash
for a in 0 0.5 1; do for b in 0 0.5 1; do
  ./build/render_wav_swarf --render /tmp/g-$a-$b.wav 2 8 4 110 "36,,,,,,,,,,,,,,," \
    drive=$a shape=$b
done; done
```

**Pick the note from the note map, not from habit.** A note-mapped module puts
its voices on consecutive notes from its `root` parameter's default — 36 for
swarf, not middle C — and rendering a note no voice answers to gives silence,
which then reads as every control being dead. Check `## Note map` in
`palette.md`, or read `root` from `module.def.json`, before rendering.

Then read them with the same descriptors palette uses, rather than by eye:

```bash
node -e '
import("./scripts/lib/descriptors.ts").then(async (d) => {
  const { readWav } = await import("./scripts/wav-io.ts");
  for (const f of process.argv.slice(1)) {
    const w = await readWav(f);
    const mono = Float64Array.from({ length: w.samples.length / w.channels },
      (_, i) => w.samples[i * w.channels]);
    const x = d.describe(mono, w.sampleRate, new Float64Array(mono.length));
    console.log(f, "peak", x.peakDb.toFixed(1), "centroid", Math.round(x.centroidHz),
                "bright", x.bright.toFixed(3), "flat", x.flatness.toFixed(3));
  }
})' /tmp/g-*.wav
```

## The three questions

**Is it only loudness?** Compare `peakDb` against `centroidHz`, `bright` and
`flatness` across the sweep. A control whose peak moves and whose spectral
descriptors do not is a gain trim wearing the name of a character control. That
is worth saying plainly — it is the most common way a module looks richer than
it is.

To be fair to it, compare **level-matched**: normalise the renders to equal peak
and ask whether anything remains. A drive that survives level-matching is a
drive; one that does not is a fader.

**Do two controls cancel?** Render the 3×3 grid. If the diagonal barely moves
while each edge does, they are pulling against each other. Sometimes that is the
design — a tilt control and a tone control legitimately oppose — and sometimes
it means one of them should not exist.

**Is a dead knob conditional?** Take each control `palette` flagged and sweep it
at the min, default and max of the parameter you suspect gates it. A knob that
comes alive somewhere is not dead; it is undocumented, and the fix is usually a
`metadata.json` description saying what it depends on, not a DSP change.

## Rules

**Level-match before judging character.** Louder reads as better. Nearly every
false positive in this area is an unmatched comparison.

**Say which of the three you found.** "Drive only moves peak, by 6 dB, with
centroid flat to within 20 Hz across the range" is a finding. "Drive feels weak"
is not.

**A real interaction is not a bug.** Report what it is before proposing to change
it — the module's brief in `plans/` may have intended it.

**Do not fix in the same pass.** Establish the behaviour, agree it with the user,
then hand to `skills/schwung-dsp-development/SKILL.md`. A DSP change mid-review
invalidates the renders the review is built on, and moves the goldens.

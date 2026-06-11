# Lobber — user manual

Lobber is a **tempo-locked slice/buffer performance effect**. It continuously records the
audio coming into it and lets you *lob* the playback head back into the recent past — to
stutter, delay-throw, reverse, freeze, loop, and slice incoming sound in time with the beat.

It's an **audio FX**: it makes no sound on its own. Put a sound source in front of it and
Lobber reshapes that source.

---

## The core idea

Think of a tape that's always rolling, recording whatever Lobber hears. Normally you listen
at the "now" point (dry). When you **Lob**, the playback head jumps **back** a number of
tempo-locked **slices** and replays the recent past — looping it (stutter), playing through
it (delay throw), reversing it, and so on. Everything is quantised to the beat, so it stays
musical.

> **Delay time = Slice length × Slices Back.**

---

## Setup

Lobber sits in an **Audio FX** slot, after a sound source:

```
Sound (synth / drums / sampler)  →  Lobber (Audio FX)  →  out
```

Feed it audio (play notes, run a sequencer, send a loop). With **Play Mode = Live** and
**Lob = 0**, Lobber is transparent — you hear the dry source. Turn **Lob** on (or switch
modes) to hear it act.

---

## Play modes

Set with the **Play Mode** control (0/1/2).

### 0 — Live (default)
Lobs the live, always-recording buffer. This is the classic stutter / delay-throw /
reverse-roll instrument. **Lob is the master engage** here: off = dry, on = effect.

### 1 — Loop
Captures a short phrase (length = **Loop Beats**) into its own loop buffer and plays it back
on repeat, **time-stretched to follow the tempo** (change **Tempo** and the loop speeds
up/down). The loop plays independently of the live source — it's a looper. On the Move it
mutes when the transport stops; in the browser it free-runs (no host transport).

*To use:* switch to Loop and let it record one phrase (about Loop Beats long), or hit
**Capture** to grab the most recent phrase immediately. **Lob** re-jumps within the loop.

### 2 — Slice
Chops the captured loop into slices (length = **Slice**) and plays them over the top of the
live input. Hold **Lob** to fire slices; held, it walks through the slices in order
(recreating the phrase). **Slices Back** picks the starting slice. Turn **Mute** on to
silence the live input and hear only the slices.

---

## Parameters

| Control | What it does |
|---|---|
| **Lob** | Master engage (Live) / slice trigger (Slice) / re-jump (Loop). Off = dry in Live mode. |
| **Slices Back** | How many slices behind "now" to jump to (0 = now/dry … 16). |
| **Slice** | Slice length on the grid: 1/4, 1/8, 1/16, 1/4T, 1/8T, 1/16T. |
| **Play Mode** | Live / Loop / Slice (see above). |
| **Loop** | On = repeat the slice (stutter). Off = play through the buffer (delay throw). |
| **Ratchet** | Subdivides the loop window for faster repeats (each step halves it). |
| **Reverse** | Play the slice backwards. |
| **Freeze** | Stop recording so the live buffer holds — lob around a frozen snapshot. |
| **Mute** | Silence the dry/live path; the wet (lob/slice) still plays. |
| **Capture** | Snapshot the most recent **Loop Beats** of audio into the loop (and retrigger it). |
| **Loop Beats** | Length of the captured loop, in beats (1–16). |
| **Mix** | Wet/dry balance of the effect against the live input. |
| **Tempo** | Fallback tempo when there's no host clock (browser/offline). On the Move the host tempo wins. |
| **Declick** | Crossfade length (ms) applied at every jump and loop seam to avoid clicks. |

---

## Playing it

**In the browser / a chain:** drive everything with the **knobs and preset buttons**. The
on-screen pad grid plays the *synth* in front of Lobber, not Lobber itself.

**On the Move (solo):** the pads become Lobber's performance surface —
- **Top two rows (16 pads):** the *lob grid*. Leftmost = "now" (slice 0); each pad to the
  right jumps one more slice into the past. Hold a pad to lob there.
- **Function row:** **Mode** (cycle Live/Loop/Slice), **Reverse** (hold), **Freeze** (hold),
  **Mute** (toggle), **Capture**.

---

## Quick recipes

- **Tempo stutter:** Live · Lob on · Loop on · Slice 1/16 · Slices Back 1–2. Add **Ratchet**
  for faster rolls.
- **Delay throw:** Live · Lob on · **Loop off** · Slice 1/8 · Slices Back 2 · Mix ~0.5.
- **Reverse roll:** Live · Lob on · Loop on · **Reverse on** · Slice 1/8T.
- **Freeze & scrub:** play something, turn **Freeze** on to hold it, then lob around the
  frozen buffer with **Slices Back**.
- **Looper:** Play Mode **Loop** · set **Loop Beats** · let it record one phrase. Drag
  **Tempo** to hear it time-stretch.
- **Slicer:** Play Mode **Slice** · hold **Lob** to roll the slices · **Mute** on for slices
  only.

---

## Tips & gotchas

- **No sound?** In Live mode with **Lob = 0** it's *meant* to be transparent — engage Lob or
  switch modes. And remember Lobber only reshapes its input: make sure a source is playing.
- **Stutter is clearest on changing/percussive material** — a single held tone, stuttered,
  still sounds like that tone.
- **Loop mode keeps playing after the source stops** — that's the point (it's a looper).
  To stop it: Play Mode back to Live, bypass the slot, or pull Mix to 0.
- **Freeze on = nothing new is recorded.** You'll hear the held snapshot, not what you play
  now. Turn it off for live-responsive behaviour.
- **Slice mode layers slices over the live input** — with a loud source they can clip; pull
  the source level down or turn **Mute** on for slices only.

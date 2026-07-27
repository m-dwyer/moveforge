# Ballast — user manual

Ballast is **one low-end voice that covers kick, tom and sub-bass**. It makes sound on its
own, so it sits in a **Synth** slot and you play it from pads or a sequencer.

Kick, tom and 808 sub are the same synthesis underneath — a pitched tone that starts high
and falls, with a click on top and saturation over the whole thing. One knob (**Track**)
moves you along that axis. That is why they are one instrument rather than three.

---

## The thirty-second version

Load a preset. Turn **Tune** until it sits with your track. Turn **Decay** for how long it
rings. Turn **Drive** for how dirty. Done.

Everything else is refinement.

---

## Page 1 — the eight that matter

These are the first eight encoders, in order.

| knob | what it does | in plain terms |
|---|---|---|
| **Tune** | base pitch, in semitones | how low it sits. 33 ≈ 55 Hz, a normal kick |
| **Punch** | attack character | the *smack*. Adds the initial pitch snap and the click together |
| **Drop** | pitch envelope depth | how far the pitch falls. Small = tight, large = an 808 dive |
| **Decay** | length in seconds | short for driving, long for hypnotic |
| **Drive** | saturation | 0 is clean. Up is dirty. What *kind* of dirty is **Curve**, on page 2 |
| **Tone** | tilt, before the drive | **0.50 is flat.** Down = dark and round. Up = mid-forward and cutting |
| **Dirt** | noise grain layer | grit that survives distortion. Leave at 0 for clean kicks |
| **Volume** | output level | |

**Tone is the most important knob you will underuse.** It sits *before* the distortion, so
it decides what gets distorted. Tone down + low Drive is the deep, round, dubby end. Tone up
+ hard clip is the mid-forward loop-tool end that cuts through a busy track. Same engine,
opposite characters.

---

## Page 2 — going deeper

| knob | what it does |
|---|---|
| **Track** | 0 = fixed pitch (a kick — the note you play doesn't matter). 1 = follows the keyboard (toms, sub-bass). In between = partly tuned |
| **Sweep** | how fast the pitch settles. Low ≈ 30 ms, tight and solid. High ≈ 190 ms, a long dive. **Around 0.2 is the tight techno window** |
| **Shape** | decay curve. Low = natural exponential fall. High = holds its level then drops off a cliff (gated) |
| **Phase** | where the waveform starts on each hit. Around 0.25 gives an instant full-amplitude attack; 0 builds over a few ms. Subtle but real |
| **Curve** | the flavour of distortion — see below |
| **Body** | sine → triangle. Adds third-harmonic *knock*. Not brightness — it does very little above 400 Hz |
| **Vel Depth** | how much velocity matters. 0 = every hit identical |
| **Human** | random variation per hit, so sixteen kicks in a row aren't sixteen copies |

### Curve — the five flavours of dirt

| value | name | sounds like |
|---|---|---|
| 0 | Soft | round, warm, thickens. Safe default |
| 1 | Asym | soft but lopsided — adds even harmonics, a bit tube-ish |
| 2 | Clip | hard and cutting. The loop-tool sound. Pair with **Tone** up |
| 3 | Fold | inharmonic and metallic. Weird on purpose |
| 4 | Crush | bit and rate reduction. Digital breakup, industrial |

All five are **completely clean at Drive 0**, so switching Curve does nothing until you turn
Drive up. Swap curves at a fixed Drive to compare them — they're level-matched, so you're
hearing character, not loudness.

---

## Track: kick vs tom vs bass

This is the one concept worth understanding.

**Track = 0** — the note you play is ignored. Every pad gives the same pitch, set by **Tune**.
This is a kick. Put it on one pad and forget about it.

**Track = 1** — the note you play sets the pitch, and **Tune 60 means you get exactly the
note you pressed**. This is a tom or a sub-bass. Set Tune to 60 for concert pitch; move it
away to transpose.

**In between** — partly tuned. Playing higher raises the pitch, but less than fully. Good
for toms that shouldn't wander too far.

> **The pivot is middle C.** At any Track setting, note 60 gives you exactly **Tune**.
> That's why Tune stays useful even at full tracking.

---

## "I want it to sound like…"

| you want | do this |
|---|---|
| **deeper** | Tune down, Tone down, Decay up, Drive down |
| **punchier** | Punch up, Sweep down, Phase to about 0.25 |
| **it to cut through a busy mix** | Tone up (0.65+), Curve 2, Drive up |
| **dirtier but still round** | Curve 0 or 1, Drive up, Tone stays at 0.5 |
| **industrial / broken** | Curve 4, Dirt up, Human up |
| **a long rumble** | Decay 1.0+, Shape low, Drive up, Tone around 0.45 |
| **a tight click** | Punch near 1, Decay 0.2, Sweep near 0, Curve 2 |
| **an 808 bassline** | Track 1, Tune 60, Decay 1.5, Punch low, Drop low |
| **a tom** | Track 0.8, Tune 47 (low) or 55 (high), Decay ~0.5 |
| **it to breathe** | Human 0.2+, Vel Depth 0.6+, and play with varying velocity |

**If it sounds thin**, you have probably got Tone too high or Body too high. Both trade low
end for mids.

**If it sounds flabby**, Sweep is too high — the pitch is still falling while the body is
sounding. Bring it down.

---

## The presets

Named family-first so the list reads in blocks when you scroll it.

| | |
|---|---|
| **Init** | neutral starting point. Also the level reference |
| **Deep Round / Deep Tunnel / Deep Rumble** | dark and low. Round is long and soft, Tunnel is short and dark, Rumble is long *and* driven |
| **Dub Boom / Dub Dive** | very long. Boom just hangs; Dive has a big pitch fall |
| **Drive Tight / Drive Click** | short and forward. Click is the shortest thing here |
| **Tool Clip / Tool Gate** | squashed, made to sit in a loop. Gate has an abrupt tail |
| **Grit Fold / Grit Crush** | distorted. Fold is metallic, Crush is digital |
| **Tom Low / Tom High** | tracked toms, a pair |
| **Sub 808 / Sub Rubber** | tracked bass. 808 is clean, Rubber is driven and elastic |

---

## Things worth knowing

**It is one-shot.** Note length does nothing — **Decay** alone decides how long a hit lasts.
Short notes in your sequencer are fine.

**Velocity changes the sound, not just the volume.** Harder hits are brighter and clickier,
not merely louder. Turn **Vel Depth** up and play with dynamics; turn it to 0 if you want a
machine.

**One voice at a time.** A new hit takes over from the old one. That's what you want for a
kick, and it means fast repeats behave.

**It leaves headroom on purpose.** Every preset peaks around −12 dBFS. Four Schwung slots
sum together with no limiter anywhere after them, so if every module ran at full scale the
mix would clip. Turn things up at the mixer, not here.

**Automation works.** Every control is smoothed, so sweeping Tone or Drive from a clip won't
click. **Curve** is the exception — it's a switch, and changing it mid-note is audible by
design.

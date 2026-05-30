// Faust source for the Trail delay audio FX module.
//
// Canonical DSP source. The matching trail_faust.c is generated from this
// file by `mise run gen-faust` (which invokes `faust -lang c -cn trail_faust`)
// and is checked into the repo so the project builds without a Faust toolchain
// installed.
//
// A lush stereo delay aimed at hypnotic techno:
//   - 4th-order fractional delay (click-free time changes + modulation)
//   - slow LFO modulation of the delay time (tape/analog wobble)
//   - filtered + saturated feedback (dub-style darkening per repeat)
//   - width control morphing stereo -> ping-pong cross-feedback
//   - an integrated reverb tail (Freeverb) blended in by "space"
//
// Param keys MUST match src/modules/trail/module.json, EXCEPT:
//   - "time" and "sync" have no slider here; the C adapter combines them with
//     the host tempo and writes the delay length (samples) into "_dtime".
//   - "_dtime" is an internal control slider, not a module.json param.

import("stdfaust.lib");

// Max fractional-delay length in samples. MUST match TRAIL_MAXDELAY in
// trail_core.h. 2^17 ~= 2.97 s at 44.1 kHz.
MAXDELAY = 131072;

// --- ~20 ms one-pole de-zipper. Applied to the gain/level controls so
//     loading a preset or turning a knob ramps instead of stepping (no click),
//     and so params fade up cleanly from zero at instance start. ---
sm(x) = x : si.smooth(ba.tau2pole(0.02));

// --- user params (1:1 with module.json) ---
fb    = hslider("feedback", 0.22, 0, 0.88, 0.01) : sm;
tone  = hslider("tone", 0.55, 0, 1, 0.01) : sm;
modd  = hslider("mod", 0.12, 0, 1, 0.01) : sm;
width = hslider("width", 0.5, 0, 1, 0.01) : sm;
drive = hslider("drive", 0.12, 0, 1, 0.01) : sm;
space = hslider("space", 0.05, 0, 1, 0.01) : sm;
mix   = hslider("mix", 0.18, 0, 1, 0.01) : sm;

// --- internal control (delay length in samples), written by the adapter.
//     Deliberately NOT smoothed: smoothing the read position would glide the
//     pitch and, from the 0 init, sweep the first echo. ---
dtime = hslider("_dtime", 13230, 1, MAXDELAY - 8, 1);

// --- feedback tone: one knob tilts dark<->bright. Low tone = dub (lowpass
//     down + gentle highpass thinning); high tone = open/bright. ---
lpCut = 350.0 + tone * tone * 11000.0;       // ~350 Hz .. ~11.4 kHz
hpCut = 25.0 + (1.0 - tone) * 275.0;         // up to ~300 Hz when dark
fbColor(x) = x : fi.highpass(1, hpCut) : fi.lowpass(1, lpCut);

// --- tape-style saturation in the feedback path. Unity-ish at drive=0. ---
sat(x) = ma.tanh(x * (1.0 + drive * 4.0)) / (1.0 + drive * 1.5);
proc(x) = fbColor(x) : sat;

// --- slow LFO modulation of the delay time (samples). L/R slightly detuned
//     for stereo decorrelation. ---
modRate  = 0.35;                              // Hz
modDepth = modd * 0.012 * ma.SR;             // up to ~12 ms
lfoL = os.osc(modRate) * modDepth;
lfoR = os.osc(modRate * 0.97) * modDepth;

// one modulated, interpolated tap; guard the minimum so mod can't drive the
// read index negative.
tapL(x) = de.fdelay4(MAXDELAY, max(64.0, dtime + lfoL), x);
tapR(x) = de.fdelay4(MAXDELAY, max(64.0, dtime + lfoR), x);

// --- stereo feedback delay network. width morphs between same-channel
//     feedback (0) and full ping-pong cross-feedback (1). The unit delay
//     inserted by ~ is negligible against the delay line length. ---
delayNet = delays ~ fbproc
with {
    fbproc(dL, dR) = gL, gR
    with {
        pL = proc(dL);
        pR = proc(dR);
        gL = fb * ((1.0 - width) * pL + width * pR);
        gR = fb * ((1.0 - width) * pR + width * pL);
    };
    delays(gL, gR, xL, xR) = tapL(xL + gL), tapR(xR + gR);
};

// --- reverb tail, blended into the wet signal by "space" (0 = pure delay,
//     1 = pure reverb wash). Fixed medium room; only the wet amount varies.
//     Faust's freeverb sums 8 feedback combs with NO output compensation, so
//     its wet output is many times hotter than its input. Apply the canonical
//     Freeverb input scaling (~0.015) so the tail sits under the delay instead
//     of swamping it. ---
revGain = 0.10;
reverb = (*(revGain), *(revGain)) : re.stereo_freeverb(0.88, 0.5, 0.4, 23);
spaceMix(dL, dR, rL, rR) = dL * (1.0 - space) + rL * space,
                           dR * (1.0 - space) + rR * space;
spaceStage = _,_ <: ((_,_), reverb) : spaceMix;

wetChain = delayNet : spaceStage;

// --- final dry/wet, hard-limited to a 0.95 ceiling so output stays finite and
//     normalized even at extremes. Transparent below the ceiling (a divisor of
//     1), so clean low-level repeats pass through untouched; only hot peaks are
//     bounded. The feedback loop itself is already bounded by the in-loop tanh. ---
limit(x) = x / max(1.0, abs(x) / 0.95);
dryWetMix(dryL, dryR, wL, wR) = limit(dryL * (1.0 - mix) + wL * mix),
                                limit(dryR * (1.0 - mix) + wR * mix);

process = _,_ <: ((_,_), wetChain) : dryWetMix;

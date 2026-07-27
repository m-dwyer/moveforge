// Faust source for the Faust-Drive audio FX module.
//
// Canonical DSP source. The matching faust_drive_faust.c is generated
// from this file by `mise run gen-faust` (which invokes
// `faust -lang c -cn faust_drive_faust`) and is checked into the repo so
// the project builds without a Faust toolchain installed.
//
// Param keys MUST match src/modules/faust_drive/module.json. The order of
// hslider declarations below matches the param index table in
// src/modules/faust_drive/dsp/faust_drive_core.c — keep them in sync.

import("stdfaust.lib");
// sm, smGain, lpSmoothed — see src/modules/_shared/moveforge.lib
import("moveforge.lib");

// Gains are de-zippered: unsmoothed, they stepped once per block, which is a
// 344 Hz buzz while a knob moves and a click on every preset load. This module
// previously smoothed nothing at all.
drive = hslider("drive", 0.3, 0, 1, 0.01) : sm;
mix   = hslider("mix",   1.0, 0, 1, 0.01) : sm;
level = hslider("level", 0.8, 0, 1, 0.01) : smGain;
// `tone` stays unsmoothed on purpose: it is a filter cutoff, and smoothing a
// cutoff forces the bilinear warping into the sample loop. lpSmoothed below
// smooths the coefficient instead.
tone  = hslider("tone",  0.5, 0, 1, 0.01);

// drive maps 0..1 -> 1x..30x pre-gain into the saturator.
preGain  = 1.0 + drive * 29.0;

// tone is a simple low-pass cutoff from 200 Hz (dark) to 8 kHz (bright).
toneCut  = 200.0 + tone * 7800.0;

limit(x) = x / (1.0 + 0.35 * abs(x));
wet(x) = x * preGain : ma.tanh : lpSmoothed(toneCut);

oneChannel = _ <: _, wet : *(1.0 - mix), *(mix) :> *(level * 0.92) : limit;

process = oneChannel, oneChannel;

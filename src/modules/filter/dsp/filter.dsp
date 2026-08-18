// Multimode Filter — stereo state-variable filter with a continuous
// lowpass -> bandpass -> highpass morph.
//
// Param keys here must match filter/module.def.json.

import("stdfaust.lib");

cutoffCtl    = hslider("cutoff",    1.0, 0.0, 1.0, 0.01);
resonanceCtl = hslider("resonance", 0.0, 0.0, 1.0, 0.01);
morphCtl     = hslider("morph",     0.0, 0.0, 1.0, 0.01);

// Deliberately unsmoothed. Faust hoists slider-only expressions out of the
// sample loop, so freq/q/trim cost one pow and one sqrt per block rather than
// per sample. Smoothing here would drag tan(), pow() and sqrt() into the inner
// loop for no audible gain: a TPT filter takes a coefficient jump without
// discontinuity, because the jump moves the coefficients and not the state.
//
// 20 Hz .. 18 kHz, so the musically useful bottom of the range gets most of
// the control travel.
freq = 20.0 * pow(900.0, cutoffCtl);

// Q 0.5 .. 20. Flat until roughly a third up, self-emphasising above that.
q = 0.5 * pow(40.0, resonanceCtl);

// The filter's passband is already unity at any Q — only the region at cutoff
// rises with resonance. Any broadband trim to tame that peak therefore ducks
// the body along with it and turns resonance into a volume control, so bound
// the peak by saturating instead. Keeps headroom below full scale so a hot
// resonant peak lands short of the converter rather than on it.
saturate(x) = 0.9 * ma.tanh(x / 0.9);

// svf_morph blends over 0..2; the control is 0..1 like every other knob here.
// Smoothed, unlike freq and q, because morph is an output mix: a step in the
// blend weights is a step in level. One sqrt per sample is the whole cost.
blend = morphCtl * 2.0 : si.smoo;

filterOne = fi.svf_morph(freq, q, blend) : saturate;

process = filterOne, filterOne;

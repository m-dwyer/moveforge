// Multimode Filter — stereo state-variable filter with a continuous
// lowpass -> bandpass -> highpass morph.
//
// Param keys here must match filter/module.def.json.
//
// The envelope is computed in filter_adapter.c and reaches this DSP only as
// the swept cutoff, so its params have no slider of their own here.
// moveforge-adapter-params: filter_attack, filter_decay, filter_sustain, filter_release, env_amount

import("stdfaust.lib");

// Cutoff and resonance arrive in the units they are, not as 0..1 knobs. The
// host owns the taper (declared "exp" in module.def.json), which is what lets
// it read the value back as "6.2 kHz" and draw the response this filter has.
//
// The cutoff the host sends is the parked one. What reaches this slider is the
// envelope's swept value, written per sub-block by filter_adapter.c.
freq     = hslider("cutoff",    18000.0, 20.0, 18000.0, 0.1);
q        = hslider("resonance",     0.5,  0.5,    20.0, 0.001);
morphCtl = hslider("morph",         0.0,  0.0,     1.0, 0.01);

// Deliberately unsmoothed. Faust hoists slider-only expressions out of the
// sample loop, so freq and q cost one tan per block rather than per sample.
// Smoothing here would drag tan() into the inner loop for no audible gain: a
// TPT filter takes a coefficient jump without discontinuity, because the jump
// moves the coefficients and not the state.

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

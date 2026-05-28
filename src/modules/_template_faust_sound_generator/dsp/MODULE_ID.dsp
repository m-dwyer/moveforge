// Minimal Faust sound-generator template for Moveforge.
//
// C owns MIDI and writes freq/gate/gain into Faust control zones each block.
// User-facing param keys here must match MODULE_ID/module.json.

import("stdfaust.lib");

freq = hslider("freq", 220.0, 16.0, 12544.0, 0.001);
gate = hslider("gate", 0.0, 0.0, 1.0, 1.0);
gain = hslider("gain", 0.8, 0.0, 1.0, 0.001);

level = hslider("level", 0.7, 0.0, 1.0, 0.01);

env = en.adsr(0.005, 0.0, 1.0, 0.2, gate);
mono = os.sawtooth(freq) * env * gain * level;

process = mono <: _, _;

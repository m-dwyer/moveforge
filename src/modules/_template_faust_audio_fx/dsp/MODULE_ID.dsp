// Minimal Faust audio FX template for Moveforge.
//
// Param keys here must match MODULE_ID/module.json.

import("stdfaust.lib");

mix   = hslider("mix",   1.0, 0.0, 1.0, 0.01);
level = hslider("level", 1.0, 0.0, 1.0, 0.01);

wet(x) = x;

oneChannel = _ <: _, wet : *(1.0 - mix), *(mix) :> *(level);

process = oneChannel, oneChannel;

import type { AuditionPatternName, AuditionState, ScaleName, StepState, TrackState } from "./chain-state";
import { makeDefaultAudition } from "./chain-state";
import type { ParamDefinition } from "./module-metadata";
import { clamp } from "./store-utils";

export function reconcileParamsFromRecord(next: ParamDefinition[], saved: Record<string, number>): ParamDefinition[] {
  return next.map((param) => ({
    ...param,
    value: clamp(saved[param.key] ?? param.default, param.min, param.max)
  }));
}

export function reconcileParamRecord(next: ParamDefinition[], saved: Record<string, number>): Record<string, number> {
  return Object.fromEntries(next.map((param) => [
    param.key,
    clamp(saved[param.key] ?? param.default, param.min, param.max)
  ]));
}

export function repairTracks(savedTracks: TrackState[] | undefined, fallback: TrackState[]): TrackState[] {
  if (!Array.isArray(savedTracks)) return fallback;
  return fallback.map((fallbackTrack, index) => {
    const saved = savedTracks[index] as Partial<TrackState> | undefined;
    if (!saved) return fallbackTrack;
    return {
      ...fallbackTrack,
      ...saved,
      activeNotes: new Map(),
      audition: repairAudition(saved.audition, fallbackTrack.audition),
      customCopySteps: repairSteps(saved.customCopySteps, fallbackTrack.customCopySteps),
    };
  });
}

export function repairSteps(savedSteps: StepState[] | undefined, fallback: StepState[]): StepState[] {
  return fallback.map((step, index) => {
    const saved = savedSteps?.[index];
    if (!saved) return step;
    return {
      enabled: Boolean(saved.enabled),
      locks: saved.locks ?? {},
      note: clamp(saved.note, 0, 127),
      velocity: clamp(saved.velocity, 0, 1)
    };
  });
}

export function repairAudition(saved: Partial<AuditionState> | undefined, fallback = makeDefaultAudition()): AuditionState {
  return {
    ...fallback,
    ...saved,
    gate: clamp(saved?.gate ?? fallback.gate, 0.05, 1),
    length: repairAuditionLength(saved?.length, fallback.length),
    pattern: repairAuditionPattern(saved?.pattern, fallback.pattern),
    transpose: clamp(Math.round(saved?.transpose ?? fallback.transpose), -24, 24),
    velocity: clamp(saved?.velocity ?? fallback.velocity, 0.05, 1)
  };
}

export function repairScaleName(value: unknown): ScaleName {
  if (value === "minor") return "natural_minor";
  if (value === "pentatonic") return "major_pentatonic";
  const allowed: ScaleName[] = [
    "major",
    "natural_minor",
    "harmonic_minor",
    "melodic_minor",
    "major_pentatonic",
    "minor_pentatonic",
    "blues",
    "dorian",
    "phrygian",
    "lydian",
    "mixolydian",
    "locrian",
    "whole_tone",
    "diminished"
  ];
  return allowed.includes(value as ScaleName) ? value as ScaleName : "major";
}

function repairAuditionLength(value: unknown, fallback: 8 | 16 | 32): 8 | 16 | 32 {
  return value === 8 || value === 16 || value === 32 ? value : fallback;
}

function repairAuditionPattern(value: unknown, fallback: AuditionPatternName): AuditionPatternName {
  const allowed: AuditionPatternName[] = [
    "custom",
    "custom_copy",
    "bass_pulse",
    "octave_bounce",
    "drone_hold",
    "chord_stab",
    "velocity_ramp",
    "acid_line",
    "minor_hook",
    "fifths",
    "syncopated_stab"
  ];
  return allowed.includes(value as AuditionPatternName) ? value as AuditionPatternName : fallback;
}

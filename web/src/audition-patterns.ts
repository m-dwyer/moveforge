import type { AuditionPatternName, StepState } from "./chain-state";

export const patternLabels: Record<AuditionPatternName, string> = {
  custom: "Custom Steps",
  custom_copy: "Custom Copy",
  bass_pulse: "Bass Pulse",
  octave_bounce: "Octave Bounce",
  drone_hold: "Drone Hold",
  chord_stab: "Chord/Stab",
  velocity_ramp: "Velocity Ramp",
  acid_line: "Acid Line",
  minor_hook: "Minor Hook",
  fifths: "Fifths",
  syncopated_stab: "Syncopated Stab"
};

export type PatternContext = {
  octave: number;
  root: number;
  steps: StepState[];
  transpose: number;
  velocity: number;
};

export type AuditionEvent = {
  gateSteps: number;
  note: number;
  velocity: number;
};

export function stepHasEvent(
  customPattern: boolean,
  pattern: AuditionPatternName,
  index: number,
  step: StepState,
  context: PatternContext
): boolean {
  return customPattern ? step.enabled : auditionEvent(pattern, index, context) !== null;
}

export function auditionEvent(pattern: AuditionPatternName, index: number, context: PatternContext): AuditionEvent | null {
  if (pattern === "custom" || pattern === "custom_copy") {
    const step = context.steps[index];
    return step?.enabled ? { note: step.note, velocity: step.velocity, gateSteps: 1 } : null;
  }

  const rootNote = 12 * (context.octave + 1) + context.root + context.transpose;
  const velocity = context.velocity;

  if (pattern === "bass_pulse") {
    const position = index % 16;
    const hits = [0, 3, 6, 8, 10, 14];
    if (!hits.includes(position)) return null;
    return { note: rootNote - 12, velocity, gateSteps: stepsUntilNextHit(position, hits, 16) };
  }
  if (pattern === "octave_bounce") {
    if (index % 2 !== 0) return null;
    return { note: rootNote - 12 + (index % 8 === 4 ? 12 : 0), velocity, gateSteps: 2 };
  }
  if (pattern === "drone_hold") {
    return index === 0 ? { note: rootNote - 12, velocity, gateSteps: 16 } : null;
  }
  if (pattern === "chord_stab") {
    const position = index % 16;
    const hits = [0, 4, 10];
    if (!hits.includes(position)) return null;
    return { note: rootNote + (position === 10 ? 3 : 0), velocity, gateSteps: stepsUntilNextHit(position, hits, 16) };
  }
  if (pattern === "velocity_ramp") {
    if (index % 2 !== 0) return null;
    const ramp = 0.35 + (index % 16) / 15 * 0.65;
    return { note: rootNote - 12, velocity: Math.min(1, velocity * ramp), gateSteps: 2 };
  }
  if (pattern === "acid_line") {
    const phrase = [0, null, 12, 10, null, 7, 3, null, 0, 3, null, 7, 10, null, 12, 7] as const;
    const offset = phrase[index % phrase.length];
    if (offset === null) return null;
    const accent = index % 8 === 0 || index % 16 === 14 ? 1 : 0.78;
    return { note: rootNote - 12 + offset, velocity: Math.min(1, velocity * accent), gateSteps: 1 };
  }
  if (pattern === "minor_hook") {
    const phrase = [0, 3, 5, 7, 10, 7, 5, 3] as const;
    if (index % 2 !== 0) return null;
    return { note: rootNote - 12 + phrase[(index / 2) % phrase.length], velocity, gateSteps: 2 };
  }
  if (pattern === "fifths") {
    const phrase = [0, 7, 12, 7] as const;
    if (index % 4 !== 0) return null;
    return { note: rootNote - 12 + phrase[(index / 4) % phrase.length], velocity, gateSteps: 4 };
  }
  if (pattern === "syncopated_stab") {
    const position = index % 16;
    const hits = [0, 5, 7, 11, 14];
    if (!hits.includes(position)) return null;
    const offset = position === 11 ? 10 : position === 14 ? 7 : 0;
    return { note: rootNote + offset, velocity, gateSteps: 1 };
  }
  return null;
}

export function materializePattern(pattern: AuditionPatternName, context: PatternContext): StepState[] {
  return context.steps.map((step, index) => {
    const event = auditionEvent(pattern, index, context);
    return {
      enabled: event !== null,
      note: event?.note ?? step.note,
      velocity: event?.velocity ?? context.velocity,
      locks: {}
    };
  });
}

export function defaultStep(): StepState {
  return { enabled: false, note: 60, velocity: 0.9, locks: {} };
}

function stepsUntilNextHit(position: number, hits: number[], cycleLength: number): number {
  for (const hit of hits) {
    if (hit > position) return hit - position;
  }
  return cycleLength - position + hits[0];
}

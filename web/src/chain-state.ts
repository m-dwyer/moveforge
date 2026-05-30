import type { ParamDefinition } from "./module-metadata.js";

export type ScaleName = "major" | "minor" | "pentatonic";
export type AuditionPatternName = "custom" | "custom_copy" | "bass_pulse" | "octave_bounce" | "drone_hold" | "chord_stab" | "velocity_ramp";

export type ParamScope = "component" | "settings";

export type ScopedParamDefinition = Omit<ParamDefinition, "id" | "value"> & {
  scope: ParamScope;
};

export type ChainKind = "midi_fx" | "sound_generator" | "audio_fx" | "settings";

export type MidiFxSlot = {
  enabled: boolean;
  id: string;
  kind: "midi_fx";
  moduleId: string | null;
  name: string;
  params: Record<string, number>;
  scaleLock: boolean;
  type: string;
};

export type SoundSlot = {
  enabled: boolean;
  id: string;
  kind: "sound_generator";
  moduleId: string | null;
  name: string;
  params: Record<string, number>;
  type: string;
};

export type AudioFxSlot = {
  enabled: boolean;
  id: string;
  kind: "audio_fx";
  moduleId: string | null;
  name: string;
  params: Record<string, number>;
  type: string;
};

export type SettingsSlot = {
  enabled: boolean;
  id: string;
  kind: "settings";
  lfos: LfoState[];
  name: string;
  params: Record<"forward_ch" | "lfo1_depth" | "lfo2_depth" | "midi_fx_output" | "receive_ch" | "slot_volume", number>;
  type: string;
};

export type ChainSlot = MidiFxSlot | SoundSlot | AudioFxSlot | SettingsSlot;

export type LfoState = {
  depth: number;
  enabled: boolean;
  phase: number;
  polarity: "bipolar" | "unipolar";
  rate: number;
  retrigger: boolean;
  shape: "sine" | "tri";
  targetComponent: string;
  targetParam: string;
};

export type TrackState = {
  activeNotes: Map<number, number>;
  audition: AuditionState;
  chain: ChainSlot[];
  customCopySteps: StepState[];
  moveEchoEvents: Array<{ at: number; note: number; velocity: number }>;
  selectedPreset: string;
  selectedStep: number;
  steps: StepState[];
};

export type MasterState = {
  chain: AudioFxSlot[];
};

export type StepState = {
  enabled: boolean;
  locks: Record<string, number>;
  note: number;
  velocity: number;
};

export type AuditionState = {
  gate: number;
  length: 8 | 16 | 32;
  pattern: AuditionPatternName;
  velocity: number;
};

export type AppState = {
  activePads: Map<number, number>;
  audition: AuditionState;
  browserIndex: number;
  context: "master" | "slot";
  customCopySteps: StepState[];
  loop: boolean;
  master: MasterState;
  masterVolume: number;
  mode: "browser" | "chain" | "device" | "seq";
  mute: boolean;
  octave: number;
  padLayout: "chromatic" | "in-key-fourths" | "in-key-octaves";
  page: number;
  playStep: number;
  playing: boolean;
  record: boolean;
  root: number;
  scale: ScaleName;
  selectedPreset: string;
  selectedSlot: number;
  selectedStep: number;
  selectedTrack: number;
  shift: boolean;
  steps: StepState[];
  touchedParam: unknown;
  tracks: TrackState[];
};

export const scales: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9]
};

export const midiFxParamDefs: ScopedParamDefinition[] = [
  { scope: "component", key: "transpose", label: "Transpose", min: -24, max: 24, default: 0, step: 1 },
  { scope: "component", key: "chance", label: "Chance", min: 0, max: 1, default: 1, step: 0.01 },
  { scope: "component", key: "velocity", label: "Velocity", min: 0.1, max: 1.5, default: 1, step: 0.01 }
];

export const audioFxParamDefs: ScopedParamDefinition[] = [
  { scope: "component", key: "drive", label: "Drive", min: 0, max: 1, default: 0.35, step: 0.01 },
  { scope: "component", key: "tone", label: "Tone", min: 0, max: 1, default: 0.72, step: 0.01 },
  { scope: "component", key: "wet", label: "Wet", min: 0, max: 1, default: 0.55, step: 0.01 }
];

export const settingsParamDefs: ScopedParamDefinition[] = [
  { scope: "settings", key: "slot_volume", label: "Slot Vol", min: 0, max: 1, default: 1, step: 0.01 },
  { scope: "settings", key: "receive_ch", label: "Recv Ch", min: 0, max: 16, default: 0, step: 1 },
  { scope: "settings", key: "forward_ch", label: "Fwd Ch", min: 0, max: 17, default: 0, step: 1 },
  { scope: "settings", key: "midi_fx_output", label: "MIDI Out", min: 0, max: 1, default: 0, step: 1 },
  { scope: "settings", key: "lfo1_depth", label: "LFO 1", min: 0, max: 1, default: 0, step: 0.01 },
  { scope: "settings", key: "lfo2_depth", label: "LFO 2", min: 0, max: 1, default: 0, step: 0.01 }
];

export function makeInitialState(moduleId: string, moduleName: string): AppState {
  return {
    mode: "device",
    context: "slot",
    page: 0,
    selectedTrack: 0,
    selectedSlot: 1,
    selectedPreset: "Init",
    browserIndex: 0,
    touchedParam: null,
    shift: false,
    record: false,
    playing: false,
    loop: false,
    mute: false,
    audition: makeDefaultAudition(),
    customCopySteps: makeDefaultSteps(false),
    selectedStep: 0,
    playStep: -1,
    padLayout: "in-key-octaves",
    root: 0,
    scale: "major",
    octave: 3,
    tracks: Array.from({ length: 4 }, () => makeSlotState(moduleId, moduleName)),
    master: makeMasterState(),
    masterVolume: 0.55,
    steps: makeDefaultSteps(false),
    activePads: new Map()
  };
}

export function makeDefaultAudition(): AuditionState {
  return {
    pattern: "custom",
    length: 16,
    gate: 0.72,
    velocity: 0.9
  };
}

function makeDefaultSteps(enabled: boolean): StepState[] {
  return Array.from({ length: 32 }, () => ({ enabled, note: 60, velocity: 0.9, locks: {} }));
}

function makeMidiFx(): MidiFxSlot {
  return {
    id: "midi-pre",
    kind: "midi_fx",
    type: "MIDI FX",
    name: "Empty",
    moduleId: null,
    enabled: false,
    scaleLock: true,
    params: {}
  };
}

function makeSound(moduleId: string, moduleName: string): SoundSlot {
  return {
    id: "sound",
    kind: "sound_generator",
    type: "Sound",
    name: moduleName,
    moduleId,
    enabled: true,
    params: {}
  };
}

function makeAudioFx(id: string, label: string): AudioFxSlot {
  return {
    id,
    kind: "audio_fx",
    type: label,
    name: "Empty",
    moduleId: null,
    enabled: false,
    params: {}
  };
}

function makeSettings(moduleId: string): SettingsSlot {
  return {
    id: "settings",
    kind: "settings",
    type: "Settings",
    name: "Slot Settings",
    enabled: true,
    params: {
      slot_volume: 1,
      receive_ch: 0,
      forward_ch: 0,
      midi_fx_output: 0,
      lfo1_depth: 0,
      lfo2_depth: 0
    },
    lfos: [
      { enabled: false, targetComponent: "sound", targetParam: "fold", shape: "sine", depth: 0, rate: 0.25, phase: 0, polarity: "bipolar", retrigger: false },
      { enabled: false, targetComponent: "audio-fx-1", targetParam: "wet", shape: "tri", depth: 0, rate: 0.125, phase: 0, polarity: "unipolar", retrigger: false }
    ]
  };
}

function makeSlotState(moduleId: string, moduleName: string): TrackState {
  return {
    audition: makeDefaultAudition(),
    chain: [
      makeMidiFx(),
      makeSound(moduleId, moduleName),
      makeAudioFx("audio-fx-1", "Audio FX 1"),
      makeAudioFx("audio-fx-2", "Audio FX 2"),
      makeSettings(moduleId)
    ],
    customCopySteps: makeDefaultSteps(false),
    selectedPreset: "Init",
    selectedStep: 0,
    steps: makeDefaultSteps(false),
    activeNotes: new Map(),
    moveEchoEvents: []
  };
}

function makeMasterState(): MasterState {
  return {
    chain: [
      makeAudioFx("master-fx-1", "Master FX 1"),
      makeAudioFx("master-fx-2", "Master FX 2"),
      makeAudioFx("master-fx-3", "Master FX 3"),
      makeAudioFx("master-fx-4", "Master FX 4")
    ]
  };
}

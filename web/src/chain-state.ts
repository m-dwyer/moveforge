import type { ParamDefinition } from "./module-metadata.js";

export type ScaleName =
  | "major"
  | "natural_minor"
  | "harmonic_minor"
  | "melodic_minor"
  | "major_pentatonic"
  | "minor_pentatonic"
  | "blues"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "whole_tone"
  | "diminished";
export type AuditionPatternName =
  | "custom"
  | "custom_copy"
  | "bass_pulse"
  | "octave_bounce"
  | "drone_hold"
  | "chord_stab"
  | "velocity_ramp"
  | "acid_line"
  | "minor_hook"
  | "fifths"
  | "syncopated_stab";

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
  name: string;
  params: Record<SettingsParamKey, number>;
  type: string;
};

export type ChainSlot = MidiFxSlot | SoundSlot | AudioFxSlot | SettingsSlot;

export type SettingsParamKey =
  | "lfo1:depth"
  | "lfo1:enabled"
  | "lfo2:depth"
  | "lfo2:enabled"
  | "midi_fx_pre_mode"
  | "slot:forward_channel"
  | "slot:muted"
  | "slot:receive_channel"
  | "slot:soloed"
  | "slot:volume";

export type TrackState = {
  activeNotes: Map<number, number>;
  audition: AuditionState;
  chain: ChainSlot[];
  customCopySteps: StepState[];
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
  transpose: number;
  velocity: number;
};

export type AppState = {
  activePads: Map<number, number>;
  audition: AuditionState;
  customCopySteps: StepState[];
  master: MasterState;
  masterVolume: number;
  mode: "browser" | "chain" | "device" | "seq";
  octave: number;
  padLayout: "chromatic" | "in-key-fourths" | "in-key-octaves";
  playStep: number;
  playing: boolean;
  root: number;
  scale: ScaleName;
  selectedPreset: string;
  selectedSlot: number;
  selectedStep: number;
  selectedTrack: number;
  steps: StepState[];
  tracks: TrackState[];
};

export const scales: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  whole_tone: [0, 2, 4, 6, 8, 10],
  diminished: [0, 2, 3, 5, 6, 8, 9, 11]
};

export const settingsParamDefs: ScopedParamDefinition[] = [
  {
    scope: "settings",
    key: "slot:volume",
    label: "Slot Vol",
    min: 0,
    max: 4,
    default: 1,
    step: 0.05,
    description: "Schwung slot gain. Browser audition does not yet route this into the audio graph."
  },
  { scope: "settings", key: "slot:muted", label: "Muted", min: 0, max: 1, default: 0, step: 1 },
  { scope: "settings", key: "slot:soloed", label: "Soloed", min: 0, max: 1, default: 0, step: 1 },
  { scope: "settings", key: "slot:receive_channel", label: "Recv Ch", min: 0, max: 16, default: 0, step: 1 },
  { scope: "settings", key: "slot:forward_channel", label: "Fwd Ch", min: -2, max: 15, default: -1, step: 1 },
  { scope: "settings", key: "midi_fx_pre_mode", label: "MIDI Pre", min: 0, max: 1, default: 0, step: 1 },
  { scope: "settings", key: "lfo1:enabled", label: "LFO 1 On", min: 0, max: 1, default: 0, step: 1 },
  { scope: "settings", key: "lfo1:depth", label: "LFO 1", min: -1, max: 1, default: 0, step: 0.01 },
  { scope: "settings", key: "lfo2:enabled", label: "LFO 2 On", min: 0, max: 1, default: 0, step: 1 },
  { scope: "settings", key: "lfo2:depth", label: "LFO 2", min: -1, max: 1, default: 0, step: 0.01 }
];

export function makeInitialState(moduleId: string, moduleName: string): AppState {
  return {
    mode: "device",
    selectedTrack: 0,
    selectedSlot: 1,
    selectedPreset: "Init",
    playing: false,
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
    transpose: 0,
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
      "slot:volume": 1,
      "slot:muted": 0,
      "slot:soloed": 0,
      "slot:receive_channel": 0,
      "slot:forward_channel": -1,
      midi_fx_pre_mode: 0,
      "lfo1:enabled": 0,
      "lfo1:depth": 0,
      "lfo2:enabled": 0,
      "lfo2:depth": 0
    }
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
    activeNotes: new Map()
  };
}

function makeMasterState(): MasterState {
  return {
    chain: [
      makeAudioFx("master_fx:fx1", "Master FX 1"),
      makeAudioFx("master_fx:fx2", "Master FX 2"),
      makeAudioFx("master_fx:fx3", "Master FX 3"),
      makeAudioFx("master_fx:fx4", "Master FX 4")
    ]
  };
}

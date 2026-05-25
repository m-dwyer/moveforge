import type { ParamDefinition } from "./module-metadata.js";

export type ScaleName = "major" | "minor" | "pentatonic";

export type ParamScope = "component" | "settings";

export type ScopedParamDefinition = Omit<ParamDefinition, "id" | "value"> & {
  scope: ParamScope;
};

export type ChainKind = "midi_fx" | "sound_generator" | "audio_fx" | "settings";

export type MidiFxSlot = {
  enabled: boolean;
  id: string;
  kind: "midi_fx";
  name: string;
  params: Record<"chance" | "transpose" | "velocity", number>;
  scaleLock: boolean;
  type: string;
};

export type SoundSlot = {
  enabled: boolean;
  id: string;
  kind: "sound_generator";
  name: string;
  type: string;
};

export type AudioFxSlot = {
  enabled: boolean;
  id: string;
  kind: "audio_fx";
  name: string;
  params: Record<"drive" | "tone" | "wet", number>;
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
  chain: ChainSlot[];
  moveEchoEvents: Array<{ at: number; note: number; velocity: number }>;
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

export type AppState = {
  activePads: Map<number, number>;
  browserIndex: number;
  context: "master" | "slot";
  loop: boolean;
  master: MasterState;
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
    selectedStep: 0,
    playStep: -1,
    padLayout: "in-key-octaves",
    root: 0,
    scale: "major",
    octave: 3,
    tracks: Array.from({ length: 4 }, () => makeSlotState(moduleId, moduleName)),
    master: makeMasterState(),
    steps: Array.from({ length: 16 }, () => ({ enabled: false, note: 60, velocity: 0.9, locks: {} })),
    activePads: new Map()
  };
}

function makeMidiFx(): MidiFxSlot {
  return {
    id: "midi-pre",
    kind: "midi_fx",
    type: "MIDI FX",
    name: "Scale Gate",
    enabled: false,
    scaleLock: true,
    params: { transpose: 0, chance: 1, velocity: 1 }
  };
}

function makeSound(moduleId: string, moduleName: string): SoundSlot {
  return { id: moduleId, kind: "sound_generator", type: "Sound", name: moduleName, enabled: true };
}

function makeAudioFx(id: string, label: string, defaults: Partial<AudioFxSlot["params"]> = {}): AudioFxSlot {
  return {
    id,
    kind: "audio_fx",
    type: label,
    name: id === "audio-fx-2" ? "Air Tone" : "Drive Tone",
    enabled: false,
    params: { drive: 0.35, tone: 0.72, wet: 0.55, ...defaults }
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
      { enabled: false, targetComponent: moduleId, targetParam: "fold", shape: "sine", depth: 0, rate: 0.25, phase: 0, polarity: "bipolar", retrigger: false },
      { enabled: false, targetComponent: "audio-fx-1", targetParam: "wet", shape: "tri", depth: 0, rate: 0.125, phase: 0, polarity: "unipolar", retrigger: false }
    ]
  };
}

function makeSlotState(moduleId: string, moduleName: string): TrackState {
  return {
    chain: [
      makeMidiFx(),
      makeSound(moduleId, moduleName),
      makeAudioFx("audio-fx-1", "Audio FX 1"),
      makeAudioFx("audio-fx-2", "Audio FX 2", { drive: 0.08, tone: 0.9, wet: 0.25 }),
      makeSettings(moduleId)
    ],
    activeNotes: new Map(),
    moveEchoEvents: []
  };
}

function makeMasterState(): MasterState {
  return {
    chain: [
      makeAudioFx("master-fx-1", "Master FX 1", { drive: 0.1, wet: 0.25 }),
      makeAudioFx("master-fx-2", "Master FX 2", { drive: 0.2, wet: 0.2 }),
      makeAudioFx("master-fx-3", "Master FX 3", { drive: 0, tone: 0.6, wet: 0 }),
      makeAudioFx("master-fx-4", "Master FX 4", { drive: 0, tone: 0.6, wet: 0 })
    ]
  };
}

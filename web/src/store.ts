import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  loadModuleIndex as fetchModuleIndex,
  loadModuleMetadata,
  type LoadedModuleMetadata,
  type ModuleIndexItem
} from "./module-metadata";
import {
  makeDefaultAudition,
  makeInitialState,
  type AppState,
  type AuditionPatternName,
  type ChainSlot,
  type ScaleName,
  type StepState,
  type TrackState
} from "./chain-state";
import type { Preset } from "./module-metadata";
import { sendParamToSlot } from "@/audio";
import type { ParamDefinition } from "./module-metadata";

export type StoreState = AppState & {
  activeModuleName: string;
  moduleId: string;
  moduleIndex: ModuleIndexItem[];
  slotMeta: Record<string, LoadedModuleMetadata>;
  topLevelParams: ParamDefinition[];
  presets: Preset[];
  /* Selected preset name per chain slot id (for audio_fx / midi_fx slots).
   * The sound_generator slot uses the top-level `selectedPreset` instead. */
  slotPreset: Record<string, string>;
  bpm: number;
  error: string | null;
};

export type StoreActions = {
  initialize: (moduleId: string) => Promise<void>;
  selectTrack: (index: number) => Promise<void>;
  selectSlot: (index: number) => void;
  setTopLevelModule: (moduleId: string) => Promise<void>;
  setSlotModule: (trackIndex: number, slotIndex: number, moduleId: string | null) => Promise<void>;
  toggleSlotBypass: (trackIndex: number, slotIndex: number) => void;
  setTopLevelParam: (key: string, value: number) => void;
  setSlotParam: (trackIndex: number, slotIndex: number, key: string, value: number) => void;
  setPadLayout: (layout: AppState["padLayout"]) => void;
  setRoot: (root: number) => void;
  setScale: (scale: ScaleName) => void;
  setOctave: (octave: number) => void;
  applyPreset: (name: string) => void;
  applySlotPreset: (trackIndex: number, slotIndex: number, name: string) => void;
  randomizeSelectedSlotParams: () => void;
  setPlaying: (playing: boolean) => void;
  setPlayStep: (index: number) => void;
  toggleStep: (index: number) => void;
  selectStep: (index: number) => void;
  setStepNote: (index: number, note: number) => void;
  setStepVelocity: (index: number, velocity: number) => void;
  forkAuditionToCustomCopy: (steps: AppState["steps"]) => void;
  toggleCustomCopyStep: (index: number) => void;
  setCustomCopyStepNote: (index: number, note: number) => void;
  setCustomCopyStepVelocity: (index: number, velocity: number) => void;
  setBpm: (bpm: number) => void;
  setMasterVolume: (volume: number) => void;
  setAuditionPattern: (pattern: AuditionPatternName) => void;
  setAuditionLength: (length: 8 | 16 | 32) => void;
  setAuditionGate: (gate: number) => void;
  setAuditionVelocity: (velocity: number) => void;
  resetUiState: () => void;
};

export type Store = StoreState & StoreActions;

const initialModuleId = "westfold";
const initialModuleName = "Westfold";
export const STORE_PERSIST_KEY = "moveforge-web-ui:v1";

export const useStore = create<Store>()(
  persist(
    immer((set, get) => ({
    ...makeInitialState(initialModuleId, initialModuleName),
    activeModuleName: initialModuleName,
    moduleId: initialModuleId,
    moduleIndex: [],
    slotMeta: {},
    topLevelParams: [],
    presets: [],
    slotPreset: {},
    bpm: 120,
    error: null,

    initialize: async (moduleId) => {
      try {
        const state = get();
        const currentSound = soundSlotForTrack(state, state.selectedTrack);
        const currentModuleId = currentSound?.moduleId ?? moduleId;
        const [indexRes, metaRes] = await Promise.all([fetchModuleIndex(), loadModuleMetadata(currentModuleId)]);
        const loadedSlotIds = new Set<string>();
        for (const track of state.tracks) {
          for (const slot of track.chain) {
            if ((slot.kind === "midi_fx" || slot.kind === "audio_fx") && slot.moduleId) {
              loadedSlotIds.add(slot.moduleId);
            }
          }
        }
        const loadedSlotMeta = await Promise.all(
          Array.from(loadedSlotIds).map(async (id) => [id, await loadModuleMetadata(id)] as const)
        );
        const metaByModuleId = Object.fromEntries(loadedSlotMeta);
        set((draft) => {
          draft.moduleIndex = indexRes.modules ?? [];
          draft.moduleId = currentModuleId;
          draft.activeModuleName = metaRes.moduleJson.name ?? currentModuleId;
          draft.topLevelParams = reconcileParamsFromRecord(metaRes.params, currentSound?.params ?? {});
          draft.presets = metaRes.presets;
          draft.selectedPreset = currentTrack(draft).selectedPreset;
          if (!metaRes.presets.some((p) => p.name === draft.selectedPreset)) draft.selectedPreset = metaRes.presets[0]?.name ?? "Init";
          currentTrack(draft).selectedPreset = draft.selectedPreset;
          draft.slotMeta = {};
          for (let trackIndex = 0; trackIndex < draft.tracks.length; trackIndex++) {
            const track = draft.tracks[trackIndex];
            const sound = track.chain.find((s) => s.kind === "sound_generator");
            if (sound) {
              if (!sound.moduleId) sound.moduleId = initialModuleId;
              if (!sound.name) sound.name = sound.moduleId;
              if (trackIndex === draft.selectedTrack) {
                sound.moduleId = currentModuleId;
                sound.name = draft.activeModuleName;
                sound.params = Object.fromEntries(draft.topLevelParams.map((p) => [p.key, p.value]));
              }
            }
            for (const slot of track.chain) {
              if (slot.kind !== "midi_fx" && slot.kind !== "audio_fx") continue;
              if (!slot.moduleId) continue;
              const slotMeta = metaByModuleId[slot.moduleId];
              if (!slotMeta) continue;
              slot.name = slotMeta.moduleJson.name ?? slot.moduleId;
              slot.params = reconcileParamRecord(slotMeta.params, slot.params as Record<string, number>);
              draft.slotMeta[trackSlotKey(trackIndex, slot.id)] = slotMeta;
            }
          }
          draft.playing = false;
          draft.playStep = -1;
          draft.error = null;
        });
      } catch (err) {
        set((draft) => {
          draft.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    selectTrack: async (index) => {
      const boundedIndex = Math.max(0, Math.min(get().tracks.length - 1, index));
      set((draft) => {
        syncGlobalSequencerToTrack(draft);
        draft.selectedTrack = boundedIndex;
        syncTrackSequencerToGlobal(draft);
      });
      const sound = soundSlotForTrack(get(), boundedIndex);
      if (!sound?.moduleId) return;
      try {
        const meta = await loadModuleMetadata(sound.moduleId);
        set((draft) => {
          const current = soundSlotForTrack(draft, boundedIndex);
          if (!current) return;
          current.name = meta.moduleJson.name ?? sound.moduleId!;
          current.params = reconcileParamRecord(meta.params, current.params);
          draft.moduleId = sound.moduleId!;
          draft.activeModuleName = current.name;
          draft.topLevelParams = reconcileParamsFromRecord(meta.params, current.params);
          draft.presets = meta.presets;
          draft.selectedPreset = draft.tracks[boundedIndex].selectedPreset;
          if (!meta.presets.some((p) => p.name === draft.selectedPreset)) draft.selectedPreset = meta.presets[0]?.name ?? "Init";
          draft.tracks[boundedIndex].selectedPreset = draft.selectedPreset;
        });
      } catch (err) {
        set((draft) => {
          draft.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    selectSlot: (index) =>
      set((draft) => {
        draft.selectedSlot = index;
      }),

    setTopLevelModule: async (moduleId) => {
      const selectedTrack = get().selectedTrack;
      if (moduleId === soundSlotForTrack(get(), selectedTrack)?.moduleId) return;
      try {
        const meta = await loadModuleMetadata(moduleId);
        set((draft) => {
          draft.moduleId = moduleId;
          draft.activeModuleName = meta.moduleJson.name ?? moduleId;
          draft.topLevelParams = meta.params;
          draft.presets = meta.presets;
          draft.selectedPreset = meta.presets[0]?.name ?? "Init";
          const track = draft.tracks[selectedTrack];
          track.selectedPreset = draft.selectedPreset;
          const sound = track.chain.find((s) => s.kind === "sound_generator");
          if (sound) {
            sound.moduleId = moduleId;
            sound.name = draft.activeModuleName;
            sound.params = Object.fromEntries(meta.params.map((p) => [p.key, p.default]));
          }
        });
      } catch (err) {
        set((draft) => {
          draft.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    setSlotModule: async (trackIndex, slotIndex, nextModuleId) => {
      const slot = get().tracks[trackIndex].chain[slotIndex];
      if (slot.kind !== "midi_fx" && slot.kind !== "audio_fx") return;
      if (slot.moduleId === nextModuleId) return;

      if (!nextModuleId) {
        set((draft) => {
          const target = draft.tracks[trackIndex].chain[slotIndex];
          if (target.kind !== "midi_fx" && target.kind !== "audio_fx") return;
          target.moduleId = null;
          target.name = "Empty";
          target.enabled = false;
          target.params = {};
          delete draft.slotMeta[trackSlotKey(trackIndex, target.id)];
          delete draft.slotPreset[trackSlotKey(trackIndex, target.id)];
        });
        return;
      }

      try {
        const meta = await loadModuleMetadata(nextModuleId);
        set((draft) => {
          const target = draft.tracks[trackIndex].chain[slotIndex];
          if (target.kind !== "midi_fx" && target.kind !== "audio_fx") return;
          target.moduleId = nextModuleId;
          target.name = meta.moduleJson.name ?? nextModuleId;
          target.enabled = true;
          target.params = Object.fromEntries(meta.params.map((p) => [p.key, p.default]));
          draft.slotMeta[trackSlotKey(trackIndex, target.id)] = meta;
          delete draft.slotPreset[trackSlotKey(trackIndex, target.id)];
        });
      } catch (err) {
        set((draft) => {
          draft.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    toggleSlotBypass: (trackIndex, slotIndex) =>
      set((draft) => {
        const slot = draft.tracks[trackIndex].chain[slotIndex];
        if (slot.kind === "settings") return;
        slot.enabled = !slot.enabled;
      }),

    setTopLevelParam: (key, value) =>
      set((draft) => {
        const param = draft.topLevelParams.find((p) => p.key === key);
        if (param) {
          param.value = value;
          const sound = soundSlotForTrack(draft, draft.selectedTrack);
          if (sound) sound.params[key] = value;
        }
      }),

    setSlotParam: (trackIndex, slotIndex, key, value) =>
      set((draft) => {
        const slot = draft.tracks[trackIndex].chain[slotIndex];
        if (slot.kind === "sound_generator") return;
        (slot.params as Record<string, number>)[key] = value;
      }),

    setPadLayout: (layout) =>
      set((draft) => {
        draft.padLayout = layout;
      }),

    setRoot: (root) =>
      set((draft) => {
        draft.root = root;
      }),

    setScale: (scale) =>
      set((draft) => {
        draft.scale = scale;
      }),

    setOctave: (octave) =>
      set((draft) => {
        draft.octave = octave;
      }),

    applyPreset: (name) => {
      const preset = get().presets.find((p) => p.name === name);
      if (!preset || !preset.params) return;
      set((draft) => {
        draft.selectedPreset = name;
        for (const [key, value] of Object.entries(preset.params!)) {
          const param = draft.topLevelParams.find((p) => p.key === key);
          if (param) param.value = value;
        }
      });
      // Push the new values to the audio engine.
      const params = get().topLevelParams;
      for (const [key, value] of Object.entries(preset.params)) {
        const p = params.find((q) => q.key === key);
        if (p) sendParamToSlot("sound", key, p.id, value);
      }
    },

    applySlotPreset: (trackIndex, slotIndex, name) => {
      const slot = get().tracks[trackIndex]?.chain[slotIndex];
      if (!slot) return;
      const meta = get().slotMeta[trackSlotKey(trackIndex, slot.id)];
      const preset = meta?.presets.find((p) => p.name === name);
      if (!preset || !preset.params) return;
      set((draft) => {
        draft.slotPreset[trackSlotKey(trackIndex, slot.id)] = name;
        const target = draft.tracks[trackIndex].chain[slotIndex];
        if (target.kind === "sound_generator" || target.kind === "settings") return;
        const params = target.params as Record<string, number>;
        for (const [key, value] of Object.entries(preset.params!)) {
          params[key] = value;
        }
      });
      // Push the new values to the audio engine for this slot.
      for (const [key, value] of Object.entries(preset.params)) {
        const p = meta?.params.find((q) => q.key === key);
        if (p) sendParamToSlot(slot.id, key, p.id, value);
      }
    },

    randomizeSelectedSlotParams: () => {
      const state = get();
      const trackIndex = state.selectedTrack;
      const slotIndex = state.selectedSlot;
      const slot = state.tracks[trackIndex]?.chain[slotIndex];
      if (!slot || slot.kind === "settings") return;

      if (slot.kind === "sound_generator") {
        const updates = randomizeParams(state.topLevelParams);
        set((draft) => {
          for (const [key, value] of Object.entries(updates)) {
            const param = draft.topLevelParams.find((p) => p.key === key);
            if (param) param.value = value;
          }
          const sound = soundSlotForTrack(draft, draft.selectedTrack);
          if (sound) Object.assign(sound.params, updates);
          draft.selectedPreset = "Random";
          currentTrack(draft).selectedPreset = "Random";
        });
        const params = get().topLevelParams;
        for (const [key, value] of Object.entries(updates)) {
          const p = params.find((q) => q.key === key);
          if (p) sendParamToSlot("sound", key, p.id, value);
        }
        return;
      }

      const meta = state.slotMeta[trackSlotKey(trackIndex, slot.id)];
      if (!meta) return;
      const updates = randomizeParams(meta.params);
      set((draft) => {
        const target = draft.tracks[trackIndex].chain[slotIndex];
        if (target.kind !== "audio_fx" && target.kind !== "midi_fx") return;
        Object.assign(target.params, updates);
        draft.slotPreset[trackSlotKey(trackIndex, target.id)] = "Random";
      });
      for (const [key, value] of Object.entries(updates)) {
        const p = meta.params.find((q) => q.key === key);
        if (p) sendParamToSlot(slot.id, key, p.id, value);
      }
    },

    setPlaying: (playing) =>
      set((draft) => {
        draft.playing = playing;
        if (!playing) draft.playStep = -1;
      }),

    setPlayStep: (index) =>
      set((draft) => {
        draft.playStep = index;
      }),

    toggleStep: (index) =>
      set((draft) => {
        draft.steps[index].enabled = !draft.steps[index].enabled;
        currentTrack(draft).steps[index].enabled = draft.steps[index].enabled;
      }),

    selectStep: (index) =>
      set((draft) => {
        draft.selectedStep = index;
        currentTrack(draft).selectedStep = index;
      }),

    setStepNote: (index, note) =>
      set((draft) => {
        draft.steps[index].note = note;
        currentTrack(draft).steps[index].note = note;
      }),

    setStepVelocity: (index, velocity) =>
      set((draft) => {
        draft.steps[index].velocity = velocity;
        currentTrack(draft).steps[index].velocity = velocity;
      }),

    forkAuditionToCustomCopy: (steps) =>
      set((draft) => {
        draft.customCopySteps = steps.map((step) => ({ ...step, locks: { ...step.locks } }));
        draft.audition.pattern = "custom_copy";
        currentTrack(draft).customCopySteps = draft.customCopySteps.map((step) => ({ ...step, locks: { ...step.locks } }));
        currentTrack(draft).audition = { ...draft.audition };
      }),

    toggleCustomCopyStep: (index) =>
      set((draft) => {
        draft.customCopySteps[index].enabled = !draft.customCopySteps[index].enabled;
        currentTrack(draft).customCopySteps[index].enabled = draft.customCopySteps[index].enabled;
      }),

    setCustomCopyStepNote: (index, note) =>
      set((draft) => {
        draft.customCopySteps[index].note = note;
        currentTrack(draft).customCopySteps[index].note = note;
      }),

    setCustomCopyStepVelocity: (index, velocity) =>
      set((draft) => {
        draft.customCopySteps[index].velocity = velocity;
        currentTrack(draft).customCopySteps[index].velocity = velocity;
      }),

    setBpm: (bpm) =>
      set((draft) => {
        draft.bpm = Math.max(40, Math.min(240, Math.round(bpm)));
      }),

    setMasterVolume: (volume) =>
      set((draft) => {
        draft.masterVolume = clamp(volume, 0, 1);
      }),

    setAuditionPattern: (pattern) =>
      set((draft) => {
        draft.audition.pattern = pattern;
        currentTrack(draft).audition.pattern = pattern;
      }),

    setAuditionLength: (length) =>
      set((draft) => {
        draft.audition.length = length;
        if (draft.playStep >= length) draft.playStep = -1;
        if (draft.selectedStep >= length) draft.selectedStep = length - 1;
        currentTrack(draft).audition.length = length;
        currentTrack(draft).selectedStep = draft.selectedStep;
      }),

    setAuditionGate: (gate) =>
      set((draft) => {
        draft.audition.gate = Math.max(0.05, Math.min(1, gate));
        currentTrack(draft).audition.gate = draft.audition.gate;
      }),

    setAuditionVelocity: (velocity) =>
      set((draft) => {
        draft.audition.velocity = Math.max(0.05, Math.min(1, velocity));
        currentTrack(draft).audition.velocity = draft.audition.velocity;
      }),

    resetUiState: () =>
      set((draft) => {
        const fresh = makeInitialState(initialModuleId, initialModuleName);
        Object.assign(draft, fresh, {
          activeModuleName: initialModuleName,
          moduleId: initialModuleId,
          moduleIndex: draft.moduleIndex,
          slotMeta: {},
          topLevelParams: [],
          presets: [],
          slotPreset: {},
          bpm: 120,
          error: null
        });
        if (typeof window !== "undefined") window.localStorage.removeItem(STORE_PERSIST_KEY);
      })
  })),
    {
      name: STORE_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        activeModuleName: state.activeModuleName,
        audition: state.audition,
        bpm: state.bpm,
        moduleId: state.moduleId,
        masterVolume: state.masterVolume,
        octave: state.octave,
        padLayout: state.padLayout,
        root: state.root,
        scale: state.scale,
        selectedPreset: state.selectedPreset,
        selectedSlot: state.selectedSlot,
        selectedStep: state.selectedStep,
        selectedTrack: state.selectedTrack,
        slotPreset: state.slotPreset,
        customCopySteps: state.customCopySteps,
        steps: state.steps,
        topLevelParams: state.topLevelParams,
        tracks: state.tracks.map((track) => ({
          audition: track.audition,
          chain: track.chain,
          customCopySteps: track.customCopySteps,
          selectedPreset: track.selectedPreset,
          selectedStep: track.selectedStep,
          steps: track.steps
        }))
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<Store> | undefined;
        if (!saved) return current;
        return {
          ...current,
          ...saved,
          audition: { ...makeDefaultAudition(), ...saved.audition },
          customCopySteps: repairSteps(saved.customCopySteps, current.customCopySteps),
          error: null,
          masterVolume: clamp(saved.masterVolume ?? current.masterVolume, 0, 1),
          moduleIndex: [],
          playStep: -1,
          playing: false,
          steps: repairSteps(saved.steps, current.steps),
          slotMeta: {},
          tracks: repairTracks(saved.tracks, current.tracks)
        };
      }
    }
  )
);

export function selectCurrentTrack(state: StoreState) {
  return state.tracks[state.selectedTrack];
}

export function selectSelectedSlot(state: StoreState): ChainSlot {
  return selectCurrentTrack(state).chain[state.selectedSlot];
}

export type SlotParamRow = {
  key: string;
  label: string;
  min: number;
  max: number;
  description?: string;
  step: number;
  value: number;
};

function reconcileParams(next: ParamDefinition[], saved: ParamDefinition[]): ParamDefinition[] {
  const savedByKey = new Map(saved.map((p) => [p.key, p.value]));
  return next.map((param) => ({
    ...param,
    value: clamp(savedByKey.get(param.key) ?? param.value ?? param.default, param.min, param.max)
  }));
}

function reconcileParamsFromRecord(next: ParamDefinition[], saved: Record<string, number>): ParamDefinition[] {
  return next.map((param) => ({
    ...param,
    value: clamp(saved[param.key] ?? param.default, param.min, param.max)
  }));
}

function reconcileParamRecord(next: ParamDefinition[], saved: Record<string, number>): Record<string, number> {
  return Object.fromEntries(next.map((param) => [
    param.key,
    clamp(saved[param.key] ?? param.default, param.min, param.max)
  ]));
}

function repairTracks(savedTracks: Store["tracks"] | undefined, fallback: Store["tracks"]): Store["tracks"] {
  if (!Array.isArray(savedTracks)) return fallback;
  return fallback.map((fallbackTrack, index) => {
    const saved = savedTracks[index] as Partial<TrackState> | undefined;
    if (!saved) return fallbackTrack;
    return {
      ...fallbackTrack,
      ...saved,
      activeNotes: new Map(),
      audition: { ...fallbackTrack.audition, ...saved.audition },
      customCopySteps: repairSteps(saved.customCopySteps, fallbackTrack.customCopySteps),
      moveEchoEvents: []
    };
  });
}

function repairSteps(savedSteps: StepState[] | undefined, fallback: StepState[]): StepState[] {
  const repaired = fallback.map((step, index) => {
    const saved = savedSteps?.[index];
    if (!saved) return step;
    return {
      enabled: Boolean(saved.enabled),
      locks: saved.locks ?? {},
      note: clamp(saved.note, 0, 127),
      velocity: clamp(saved.velocity, 0, 1)
    };
  });
  return repaired;
}

function randomizeParams(params: ParamDefinition[]): Record<string, number> {
  return Object.fromEntries(params.map((param) => [param.key, randomParamValue(param)]));
}

function randomParamValue(param: ParamDefinition): number {
  const min = Number.isFinite(param.min) ? param.min : 0;
  const max = Number.isFinite(param.max) ? param.max : min;
  const raw = min + Math.random() * (max - min);
  const step = param.step && param.step > 0 ? param.step : 0;
  if (!step) return clamp(raw, min, max);
  const stepped = min + Math.round((raw - min) / step) * step;
  const decimals = Math.max(0, decimalPlaces(step));
  return Number(clamp(stepped, min, max).toFixed(decimals));
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function currentTrack(state: Pick<StoreState, "selectedTrack" | "tracks">): TrackState {
  return state.tracks[state.selectedTrack];
}

function syncGlobalSequencerToTrack(state: StoreState): void {
  const track = currentTrack(state);
  track.audition = { ...state.audition };
  track.customCopySteps = state.customCopySteps.map((step) => ({ ...step, locks: { ...step.locks } }));
  track.selectedPreset = state.selectedPreset;
  track.selectedStep = state.selectedStep;
  track.steps = state.steps.map((step) => ({ ...step, locks: { ...step.locks } }));
}

function syncTrackSequencerToGlobal(state: StoreState): void {
  const track = currentTrack(state);
  state.audition = { ...track.audition };
  state.customCopySteps = repairSteps(track.customCopySteps, state.customCopySteps);
  state.selectedPreset = track.selectedPreset;
  state.selectedStep = track.selectedStep;
  state.steps = repairSteps(track.steps, state.steps);
  state.playStep = -1;
  state.playing = false;
}

function soundSlotForTrack(state: Pick<StoreState, "tracks">, trackIndex: number) {
  const slot = state.tracks[trackIndex]?.chain.find((s) => s.kind === "sound_generator");
  return slot?.kind === "sound_generator" ? slot : null;
}

export function trackSlotKey(trackIndex: number, slotId: string): string {
  return `${trackIndex}:${slotId}`;
}

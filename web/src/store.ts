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
  makeInitialState,
  type AppState,
  type AuditionPatternName,
  type ChainSlot,
  type ScaleName,
  type TrackState
} from "./chain-state";
import { densePresetValues } from "../../shared/presets.ts";
import type { Preset } from "./module-metadata";
import { sendParamUpdate, sendParamUpdates, type HostParamUpdate } from "@/audio";
import type { ParamDefinition } from "./module-metadata";
import {
  applyParamUpdatesToDraft,
  currentParamSnapshotKey,
  liveParamRecord,
  paramUpdatesForSnapshot,
  repairParamSnapshots,
  type ParamSnapshotBank,
  type ParamSnapshotLabel
} from "./param-snapshots";
import { RANDOMIZE_AMOUNTS, randomizeParams, repairRandomizeAmount, type RandomizeAmount } from "./param-randomize";
import {
  reconcileParamRecord,
  reconcileParamsFromRecord,
  repairAudition,
  repairScaleName,
  repairSteps,
  repairTracks
} from "./store-repair";
import { clamp, trackSlotKey } from "./store-utils";

export { PARAM_SNAPSHOT_LABELS, type ParamSnapshotLabel } from "./param-snapshots";
export { RANDOMIZE_AMOUNTS, type RandomizeAmount } from "./param-randomize";
export { trackSlotKey } from "./store-utils";

export type StoreState = AppState & {
  activeModuleName: string;
  moduleId: string;
  moduleIndex: ModuleIndexItem[];
  paramSnapshots: Record<string, ParamSnapshotBank>;
  slotMeta: Record<string, LoadedModuleMetadata>;
  selectedParamSnapshot: Record<string, ParamSnapshotLabel>;
  topLevelParams: ParamDefinition[];
  presets: Preset[];
  randomizeAmount: RandomizeAmount;
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
  setPadActive: (padIndex: number, active: boolean) => void;
  setRoot: (root: number) => void;
  setScale: (scale: ScaleName) => void;
  setOctave: (octave: number) => void;
  applyPreset: (name: string) => void;
  applySlotPreset: (trackIndex: number, slotIndex: number, name: string) => void;
  randomizeSelectedSlotParams: () => void;
  setRandomizeAmount: (amount: RandomizeAmount) => void;
  selectParamSnapshot: (label: ParamSnapshotLabel) => void;
  captureParamSnapshot: (label: ParamSnapshotLabel) => void;
  recallParamSnapshot: (label: ParamSnapshotLabel) => void;
  swapParamSnapshot: (label: ParamSnapshotLabel) => void;
  clearParamSnapshot: (label: ParamSnapshotLabel) => void;
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
  setAuditionTranspose: (transpose: number) => void;
  setAuditionVelocity: (velocity: number) => void;
  resetUiState: () => void;
};

export type Store = StoreState & StoreActions;

const initialModuleId = "westfold";
const initialModuleName = "Westfold";
export const STORE_PERSIST_KEY = "moveforge-web-ui:v1";
const STORE_PERSIST_VERSION = 2;

export const useStore = create<Store>()(
  persist(
    immer((set, get) => ({
    ...makeInitialState(initialModuleId, initialModuleName),
    activeModuleName: initialModuleName,
    moduleId: initialModuleId,
    moduleIndex: [],
    paramSnapshots: {},
    slotMeta: {},
    selectedParamSnapshot: {},
    topLevelParams: [],
    presets: [],
    randomizeAmount: "medium",
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

    setTopLevelParam: (key, value) => {
      set((draft) => {
        const param = draft.topLevelParams.find((p) => p.key === key);
        if (param) {
          param.value = value;
          const sound = soundSlotForTrack(draft, draft.selectedTrack);
          if (sound) sound.params[key] = value;
        }
      });
      const param = get().topLevelParams.find((p) => p.key === key);
      if (param) sendParamUpdate({ slotId: "sound", key, id: param.id, value });
    },

    setSlotParam: (trackIndex, slotIndex, key, value) => {
      set((draft) => {
        const slot = draft.tracks[trackIndex].chain[slotIndex];
        if (slot.kind === "sound_generator") return;
        (slot.params as Record<string, number>)[key] = value;
      });
      const slot = get().tracks[trackIndex]?.chain[slotIndex];
      if (!slot || slot.kind === "settings" || slot.kind === "sound_generator") return;
      const param = get().slotMeta[trackSlotKey(trackIndex, slot.id)]?.params.find((p) => p.key === key);
      if (param) sendParamUpdate({ slotId: slot.id, key, id: param.id, value });
    },

    setPadLayout: (layout) =>
      set((draft) => {
        draft.padLayout = layout;
      }),

    setPadActive: (padIndex, active) => {
      const next = new Map(get().activePads);
      const count = next.get(padIndex) ?? 0;
      if (active) {
        next.set(padIndex, count + 1);
      } else if (count <= 1) {
        next.delete(padIndex);
      } else {
        next.set(padIndex, count - 1);
      }
      set((draft) => {
        draft.activePads = next;
      });
    },

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
      if (!preset) return;
      // Every declared param, not just the ones the preset names: a preset may omit
      // a key to mean "leave it at its default", and on device <id>_apply_preset
      // writes the whole dense table. Applying only the named keys would leave the
      // previous preset's values behind and make the browser disagree with hardware.
      const values = resolvedPresetValues(get().topLevelParams, preset, name);
      set((draft) => {
        draft.selectedPreset = name;
        for (const param of draft.topLevelParams) param.value = values[param.key];
      });
      // Push the new values to the audio engine.
      sendParamUpdates(paramUpdatesForEntries("sound", get().topLevelParams, values));
    },

    applySlotPreset: (trackIndex, slotIndex, name) => {
      const slot = get().tracks[trackIndex]?.chain[slotIndex];
      if (!slot) return;
      const meta = get().slotMeta[trackSlotKey(trackIndex, slot.id)];
      const preset = meta?.presets.find((p) => p.name === name);
      if (!meta || !preset) return;
      // Dense, for the reason given in applyPreset.
      const values = resolvedPresetValues(meta.params, preset, name);
      set((draft) => {
        draft.slotPreset[trackSlotKey(trackIndex, slot.id)] = name;
        const target = draft.tracks[trackIndex].chain[slotIndex];
        if (target.kind === "sound_generator" || target.kind === "settings") return;
        const params = target.params as Record<string, number>;
        for (const [key, value] of Object.entries(values)) {
          params[key] = value;
        }
      });
      // Push the new values to the audio engine for this slot.
      sendParamUpdates(paramUpdatesForEntries(slot.id, meta.params, values));
    },

    randomizeSelectedSlotParams: () => {
      const state = get();
      const trackIndex = state.selectedTrack;
      const slotIndex = state.selectedSlot;
      const slot = state.tracks[trackIndex]?.chain[slotIndex];
      if (!slot || slot.kind === "settings") return;

      if (slot.kind === "sound_generator") {
        const updates = randomizeParams(state.topLevelParams, Object.fromEntries(state.topLevelParams.map((p) => [p.key, p.value])), state.randomizeAmount);
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
        sendParamUpdates(paramUpdatesForEntries("sound", get().topLevelParams, updates));
        return;
      }

      const meta = state.slotMeta[trackSlotKey(trackIndex, slot.id)];
      if (!meta) return;
      const updates = randomizeParams(meta.params, slot.params as Record<string, number>, state.randomizeAmount);
      set((draft) => {
        const target = draft.tracks[trackIndex].chain[slotIndex];
        if (target.kind !== "audio_fx" && target.kind !== "midi_fx") return;
        Object.assign(target.params, updates);
        draft.slotPreset[trackSlotKey(trackIndex, target.id)] = "Random";
      });
      sendParamUpdates(paramUpdatesForEntries(slot.id, meta.params, updates));
    },

    setRandomizeAmount: (amount) =>
      set((draft) => {
        draft.randomizeAmount = RANDOMIZE_AMOUNTS.includes(amount) ? amount : "medium";
      }),

    selectParamSnapshot: (label) =>
      set((draft) => {
        const key = currentParamSnapshotKey(draft);
        if (key) draft.selectedParamSnapshot[key] = label;
      }),

    captureParamSnapshot: (label) =>
      set((draft) => {
        const key = currentParamSnapshotKey(draft);
        if (!key) return;
        draft.paramSnapshots[key] = draft.paramSnapshots[key] ?? {};
        draft.paramSnapshots[key][label] = liveParamRecord(draft);
        draft.selectedParamSnapshot[key] = label;
      }),

    recallParamSnapshot: (label) => {
      const state = get();
      const key = currentParamSnapshotKey(state);
      const snapshot = key ? state.paramSnapshots[key]?.[label] : null;
      if (!snapshot) return;
      const updates = paramUpdatesForSnapshot(state, snapshot);
      set((draft) => {
        applyParamUpdatesToDraft(draft, updates);
        if (key) draft.selectedParamSnapshot[key] = label;
      });
      sendParamUpdates(updates);
    },

    swapParamSnapshot: (label) => {
      const state = get();
      const key = currentParamSnapshotKey(state);
      const snapshot = key ? state.paramSnapshots[key]?.[label] : null;
      if (!key || !snapshot) return;
      const live = liveParamRecord(state);
      const updates = paramUpdatesForSnapshot(state, snapshot);
      set((draft) => {
        applyParamUpdatesToDraft(draft, updates);
        draft.paramSnapshots[key] = draft.paramSnapshots[key] ?? {};
        draft.paramSnapshots[key][label] = live;
        draft.selectedParamSnapshot[key] = label;
      });
      sendParamUpdates(updates);
    },

    clearParamSnapshot: (label) =>
      set((draft) => {
        const key = currentParamSnapshotKey(draft);
        if (!key) return;
        delete draft.paramSnapshots[key]?.[label];
      }),

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

    setAuditionTranspose: (transpose) =>
      set((draft) => {
        draft.audition.transpose = clamp(Math.round(transpose), -24, 24);
        currentTrack(draft).audition.transpose = draft.audition.transpose;
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
          paramSnapshots: {},
          slotMeta: {},
          selectedParamSnapshot: {},
          topLevelParams: [],
          presets: [],
          randomizeAmount: "medium",
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
      version: STORE_PERSIST_VERSION,
      migrate: (persisted) => persisted,
      partialize: (state) => ({
        activeModuleName: state.activeModuleName,
        audition: state.audition,
        bpm: state.bpm,
        moduleId: state.moduleId,
        masterVolume: state.masterVolume,
        octave: state.octave,
        paramSnapshots: state.paramSnapshots,
        padLayout: state.padLayout,
        randomizeAmount: state.randomizeAmount,
        root: state.root,
        scale: state.scale,
        selectedPreset: state.selectedPreset,
        selectedParamSnapshot: state.selectedParamSnapshot,
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
          audition: repairAudition(saved.audition),
          activePads: new Map(),
          customCopySteps: repairSteps(saved.customCopySteps, current.customCopySteps),
          error: null,
          masterVolume: clamp(saved.masterVolume ?? current.masterVolume, 0, 1),
          moduleIndex: [],
          paramSnapshots: repairParamSnapshots(saved.paramSnapshots),
          playStep: -1,
          playing: false,
          randomizeAmount: repairRandomizeAmount(saved.randomizeAmount),
          scale: repairScaleName(saved.scale),
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

/* A preset's values for every declared param, with omitted keys at their defaults —
 * the same resolution the generated C table and the render harness use. */
function resolvedPresetValues(
  params: ParamDefinition[],
  preset: Preset,
  name: string
): Record<string, number> {
  const resolved = densePresetValues(params, preset.params, `preset ${name}`);
  return Object.fromEntries(resolved.map((entry) => [entry.key, entry.value]));
}

function paramUpdatesForEntries(
  slotId: string,
  params: ParamDefinition[],
  entries: Record<string, number>
): HostParamUpdate[] {
  return Object.entries(entries).flatMap(([key, value]) => {
    const param = params.find((candidate) => candidate.key === key);
    return param ? [{ slotId, key, id: param.id, value }] : [];
  });
}

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  loadModuleIndex as fetchModuleIndex,
  loadModuleMetadata,
  type LoadedModuleMetadata,
  type ModuleIndexItem
} from "./module-metadata";
import { makeInitialState, type AppState, type ChainSlot, type ScaleName } from "./chain-state";
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
  bpm: number;
  error: string | null;
};

export type StoreActions = {
  initialize: (moduleId: string) => Promise<void>;
  selectTrack: (index: number) => void;
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
  setPlaying: (playing: boolean) => void;
  setPlayStep: (index: number) => void;
  toggleStep: (index: number) => void;
  selectStep: (index: number) => void;
  setStepNote: (index: number, note: number) => void;
  setStepVelocity: (index: number, velocity: number) => void;
  setBpm: (bpm: number) => void;
};

export type Store = StoreState & StoreActions;

const initialModuleId = "westfold";
const initialModuleName = "Westfold";

export const useStore = create<Store>()(
  immer((set, get) => ({
    ...makeInitialState(initialModuleId, initialModuleName),
    activeModuleName: initialModuleName,
    moduleId: initialModuleId,
    moduleIndex: [],
    slotMeta: {},
    topLevelParams: [],
    presets: [],
    bpm: 120,
    error: null,

    initialize: async (moduleId) => {
      try {
        const [indexRes, metaRes] = await Promise.all([fetchModuleIndex(), loadModuleMetadata(moduleId)]);
        set((draft) => {
          draft.moduleIndex = indexRes.modules ?? [];
          draft.moduleId = moduleId;
          draft.activeModuleName = metaRes.moduleJson.name ?? moduleId;
          draft.topLevelParams = metaRes.params;
          draft.presets = metaRes.presets;
          draft.selectedPreset = metaRes.presets[0]?.name ?? "Init";
          for (const track of draft.tracks) {
            const sound = track.chain.find((s) => s.kind === "sound_generator");
            if (sound) {
              sound.moduleId = moduleId;
              sound.name = draft.activeModuleName;
            }
          }
        });
      } catch (err) {
        set((draft) => {
          draft.error = err instanceof Error ? err.message : String(err);
        });
      }
    },

    selectTrack: (index) =>
      set((draft) => {
        draft.selectedTrack = index;
      }),

    selectSlot: (index) =>
      set((draft) => {
        draft.selectedSlot = index;
      }),

    setTopLevelModule: async (moduleId) => {
      if (moduleId === get().moduleId) return;
      try {
        const meta = await loadModuleMetadata(moduleId);
        set((draft) => {
          draft.moduleId = moduleId;
          draft.activeModuleName = meta.moduleJson.name ?? moduleId;
          draft.topLevelParams = meta.params;
          draft.presets = meta.presets;
          draft.selectedPreset = meta.presets[0]?.name ?? "Init";
          for (const track of draft.tracks) {
            const sound = track.chain.find((s) => s.kind === "sound_generator");
            if (sound) {
              sound.moduleId = moduleId;
              sound.name = draft.activeModuleName;
            }
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
          delete draft.slotMeta[target.id];
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
          draft.slotMeta[target.id] = meta;
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
        if (param) param.value = value;
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
      }),

    selectStep: (index) =>
      set((draft) => {
        draft.selectedStep = index;
      }),

    setStepNote: (index, note) =>
      set((draft) => {
        draft.steps[index].note = note;
      }),

    setStepVelocity: (index, velocity) =>
      set((draft) => {
        draft.steps[index].velocity = velocity;
      }),

    setBpm: (bpm) =>
      set((draft) => {
        draft.bpm = Math.max(40, Math.min(240, Math.round(bpm)));
      })
  }))
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
  step: number;
  value: number;
};

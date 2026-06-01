import type { LoadedModuleMetadata, ParamDefinition } from "./module-metadata";
import type { ChainSlot, TrackState } from "./chain-state";
import { clamp, trackSlotKey } from "./store-utils";

export const PARAM_SNAPSHOT_LABELS = ["A", "B", "C", "D"] as const;
export type ParamSnapshotLabel = typeof PARAM_SNAPSHOT_LABELS[number];
export type ParamSnapshotBank = Partial<Record<ParamSnapshotLabel, Record<string, number>>>;

export type ParamUpdate = {
  id: number;
  key: string;
  slotId: string;
  slotIndex: number;
  trackIndex: number;
  value: number;
};

export type SnapshotState = {
  selectedSlot: number;
  selectedTrack: number;
  slotMeta: Record<string, LoadedModuleMetadata>;
  topLevelParams: ParamDefinition[];
  tracks: TrackState[];
};

export function currentParamSnapshotKey(
  state: Pick<SnapshotState, "selectedSlot" | "selectedTrack" | "tracks">
): string | null {
  const slot = state.tracks[state.selectedTrack]?.chain[state.selectedSlot];
  if (!slot || slot.kind === "settings" || !slot.moduleId) return null;
  return `${state.selectedTrack}:${slot.id}:${slot.moduleId}`;
}

export function liveParamRecord(
  state: Pick<SnapshotState, "selectedSlot" | "selectedTrack" | "tracks" | "topLevelParams">
): Record<string, number> {
  const slot = state.tracks[state.selectedTrack]?.chain[state.selectedSlot];
  if (!slot || slot.kind === "settings") return {};
  if (slot.kind === "sound_generator") {
    return Object.fromEntries(state.topLevelParams.map((param) => [param.key, param.value]));
  }
  return { ...(slot.params as Record<string, number>) };
}

export function paramUpdatesForSnapshot(
  state: SnapshotState,
  snapshot: Record<string, number>
): ParamUpdate[] {
  const trackIndex = state.selectedTrack;
  const slotIndex = state.selectedSlot;
  const slot = state.tracks[trackIndex]?.chain[slotIndex];
  if (!slot || slot.kind === "settings") return [];

  if (slot.kind === "sound_generator") {
    return state.topLevelParams
      .filter((param) => snapshot[param.key] !== undefined)
      .map((param) => ({
        id: param.id,
        key: param.key,
        slotId: "sound",
        slotIndex,
        trackIndex,
        value: clamp(snapshot[param.key], param.min, param.max)
      }));
  }

  const meta = state.slotMeta[trackSlotKey(trackIndex, slot.id)];
  if (!meta) return [];
  return meta.params
    .filter((param) => snapshot[param.key] !== undefined)
    .map((param) => ({
      id: param.id,
      key: param.key,
      slotId: slot.id,
      slotIndex,
      trackIndex,
      value: clamp(snapshot[param.key], param.min, param.max)
    }));
}

export function applyParamUpdatesToDraft(
  state: Pick<SnapshotState, "topLevelParams" | "tracks">,
  updates: ParamUpdate[]
): void {
  for (const update of updates) {
    const slot = state.tracks[update.trackIndex]?.chain[update.slotIndex] as ChainSlot | undefined;
    if (!slot || slot.kind === "settings") continue;
    if (slot.kind === "sound_generator") {
      const param = state.topLevelParams.find((p) => p.key === update.key);
      if (param) param.value = update.value;
      slot.params[update.key] = update.value;
    } else {
      (slot.params as Record<string, number>)[update.key] = update.value;
    }
  }
}

export function repairParamSnapshots(
  saved: Record<string, ParamSnapshotBank> | undefined
): Record<string, ParamSnapshotBank> {
  if (!saved || typeof saved !== "object") return {};
  const repaired: Record<string, ParamSnapshotBank> = {};
  for (const [key, bank] of Object.entries(saved)) {
    if (!bank || typeof bank !== "object") continue;
    for (const label of PARAM_SNAPSHOT_LABELS) {
      const snapshot = bank[label];
      if (!snapshot || typeof snapshot !== "object") continue;
      const params = Object.fromEntries(
        Object.entries(snapshot).filter(([, value]) => Number.isFinite(value))
      );
      if (Object.keys(params).length === 0) continue;
      repaired[key] = repaired[key] ?? {};
      repaired[key][label] = params;
    }
  }
  return repaired;
}

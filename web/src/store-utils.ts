export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function trackSlotKey(trackIndex: number, slotId: string): string {
  return `${trackIndex}:${slotId}`;
}

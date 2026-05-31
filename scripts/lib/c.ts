export function cFloatLiteral(value: number, label: string): string {
  if (!Number.isFinite(value)) throw new Error(`non-finite ${label}: ${value}`);
  const s = Number(value.toPrecision(9)).toString();
  return s.includes(".") || s.includes("e") || s.includes("E") ? `${s}f` : `${s}.0f`;
}

export function escapeCString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

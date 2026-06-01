import type { ParamDefinition } from "./module-metadata";
import { clamp } from "./store-utils";

export const RANDOMIZE_AMOUNTS = ["subtle", "medium", "wild"] as const;
export type RandomizeAmount = typeof RANDOMIZE_AMOUNTS[number];

export function randomizeParams(
  params: ParamDefinition[],
  current: Record<string, number>,
  amount: RandomizeAmount
): Record<string, number> {
  return Object.fromEntries(params.map((param) => [param.key, randomParamValue(param, current[param.key], amount)]));
}

export function repairRandomizeAmount(value: unknown): RandomizeAmount {
  return RANDOMIZE_AMOUNTS.includes(value as RandomizeAmount) ? value as RandomizeAmount : "medium";
}

function randomParamValue(param: ParamDefinition, currentValue: number | undefined, amount: RandomizeAmount): number {
  const declaredMin = Number.isFinite(param.min) ? param.min : 0;
  const declaredMax = Number.isFinite(param.max) ? param.max : declaredMin;
  const hint = param.randomize;
  const hintedMin = Number.isFinite(hint?.min) ? hint!.min! : declaredMin;
  const hintedMax = Number.isFinite(hint?.max) ? hint!.max! : declaredMax;
  const min = clamp(hintedMin, declaredMin, declaredMax);
  const max = clamp(Math.max(hintedMin, hintedMax), min, declaredMax);
  const baseWidth = Math.max(0, max - min);
  const centerSource = hint?.mode === "around_default" ? param.default : currentValue ?? param.default;
  const center = clamp(centerSource, min, max);
  const amountScale = randomizeScale(amount, hint?.amount);
  const rangeWidth = hint?.mode === "full" ? baseWidth : baseWidth * amountScale;
  const lo = rangeWidth >= baseWidth ? min : clamp(center - rangeWidth / 2, min, max);
  const hi = rangeWidth >= baseWidth ? max : clamp(center + rangeWidth / 2, min, max);
  const value = lo + Math.random() * Math.max(0, hi - lo);
  const step = param.step && param.step > 0 ? param.step : 0;
  if (!step) return clamp(value, min, max);
  const stepped = declaredMin + Math.round((value - declaredMin) / step) * step;
  const decimals = Math.max(0, decimalPlaces(step));
  return Number(clamp(stepped, min, max).toFixed(decimals));
}

function randomizeScale(amount: RandomizeAmount, hintAmount?: number): number {
  const base = amount === "subtle" ? 0.18 : amount === "medium" ? 0.45 : 1;
  if (!Number.isFinite(hintAmount)) return base;
  return clamp(base * hintAmount!, 0.01, 1);
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

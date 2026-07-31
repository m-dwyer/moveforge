/*
 * Turn a parameter's value and unit into something a person can read.
 *
 * This is the display half of the unit vocabulary in `module-schema.ts`, and
 * like it, it belongs to no target: "0.35 with unit % reads as 35%" is a fact
 * about percentages. Anything that renders a parameter — the browser, an
 * audition report, a future desktop UI — should get the same answer from here
 * rather than inventing its own rounding.
 *
 * Where a target has its own renderer, matching it is a conformance question,
 * not a reason to move this file. Schwung has two, and they are not even
 * identical to each other: the shadow UI (src/shared/param_format.mjs) and the
 * chain host in C (chain_params.c:20-60), where a float without an explicit
 * display_format gets "%.2f" and the unit is appended after a space — so a
 * percentage reads "35.00 %" there and "35%" here. The rules that matter —
 * which units scale, which round, which carry a sign — agree, and this file
 * follows them. The cosmetic difference is upstream's.
 *
 * `display_format` is a schwung field (a printf string for its snprintf), not
 * part of the vocabulary. It is honoured here only so a value rendered locally
 * matches a module that declares one; targets/schwung.ts owns whether it may be
 * declared at all.
 */

/** Decimals implied by a step size. */
export function precisionForStep(step: number | undefined, fallback = 2): number {
  const s = Math.abs(Number(step));
  if (!Number.isFinite(s) || s <= 0) return fallback;
  if (s >= 1) return 0;
  if (s >= 0.1) return 1;
  if (s >= 0.01) return 2;
  if (s >= 0.001) return 3;
  return 4;
}

/** The printf subset the device accepts: ".Nf" renders a fixed point, ".N%" scales by 100. */
export function applyDisplayFormat(format: string, value: number): string | null {
  const match = /^%?\.(\d{1,2})([f%])$/.exec(format);
  if (!match) return null;
  const decimals = Number(match[1]);
  return match[2] === "%" ? `${(value * 100).toFixed(decimals)}%` : value.toFixed(decimals);
}

export type FormattableParam = {
  display_format?: string | undefined;
  max?: number | undefined;
  step?: number | undefined;
  type?: string | undefined;
  unit?: string | undefined;
};

function formatPercent(value: number, param: FormattableParam): string {
  const max = typeof param.max === "number" ? param.max : 1;
  const display = max <= 1 ? value * 100 : value;
  /* Percentages read as whole numbers unless the step is finer than 1% of the
   * displayed range, which is the only case where the extra digit says
   * anything. */
  let decimals = 0;
  if (typeof param.step === "number" && param.step > 0) {
    if (max <= 1 && param.step < 0.01) decimals = precisionForStep(param.step) - 2;
    else if (max > 1 && param.step < 1) decimals = precisionForStep(param.step);
  }
  return `${display.toFixed(Math.max(decimals, 0))}%`;
}

function formatHz(value: number, param: FormattableParam): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} kHz`;
  return `${value.toFixed(precisionForStep(param.step, 0))} Hz`;
}

/**
 * A parameter value as the device would show it. Returns null when the param
 * carries no unit and nothing else applies, so a caller can keep its own
 * fallback rather than having one imposed.
 */
export function formatParamValue(value: number, param: FormattableParam): string | null {
  if (!Number.isFinite(value)) return null;

  if (param.display_format) {
    const formatted = applyDisplayFormat(param.display_format, value);
    if (formatted !== null) {
      if (formatted.endsWith("%")) return formatted;
      return param.unit ? `${formatted} ${param.unit}` : formatted;
    }
  }

  const unit = param.unit;
  if (!unit) return null;

  if (unit === "dB") return `${value.toFixed(precisionForStep(param.step, 1))} dB`;
  if (unit === "Hz") return formatHz(value, param);
  if (unit === "ms") return `${value.toFixed(precisionForStep(param.step, 1))} ms`;
  if (unit === "sec") return `${value.toFixed(precisionForStep(param.step, 3))} sec`;
  if (unit === "%") return formatPercent(value, param);
  /* Semitones are an interval, so the sign is part of the reading. */
  if (unit === "st") {
    const n = Math.round(value);
    return n > 0 ? `+${n} st` : `${n} st`;
  }
  if (unit === "BPM") return `${Math.round(value)} BPM`;

  if (param.type === "int") return `${Math.round(value)} ${unit}`;
  return `${value.toFixed(precisionForStep(param.step))} ${unit}`;
}

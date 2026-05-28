import { useEffect } from "react";
import { useStore } from "@/store";
import { noteOff, noteOn } from "@/audio";
import { noteForPad } from "@/lib/pads";

// QWERTY → pad index (matches the legacy mapping). Lower row + top row mirror
// piano white/black keys for the first 16 pads.
export const KEY_TO_PAD: Record<string, number> = {
  a: 0, w: 1, s: 2, d: 3, r: 4, f: 5, t: 6, g: 7,
  h: 8, u: 9, j: 10, i: 11, k: 12, o: 13, l: 14, ";": 15
};

export function useKeyboardPlay(): void {
  useEffect(() => {
    const held = new Map<string, number>();

    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (hasShortcutModifier(e)) return;

      if (e.key === " ") {
        e.preventDefault();
        useStore.getState().setPlaying(!useStore.getState().playing);
        return;
      }

      const padIndex = KEY_TO_PAD[e.key.toLowerCase()];
      if (padIndex === undefined) return;
      e.preventDefault();

      const s = useStore.getState();
      const note = noteForPad(padIndex, {
        padLayout: s.padLayout,
        root: s.root,
        scale: s.scale,
        octave: s.octave
      });
      held.set(e.key, note);
      void noteOn(note, 0.94);
    };

    const onUp = (e: KeyboardEvent) => {
      const note = held.get(e.key);
      if (note === undefined) return;
      held.delete(e.key);
      noteOff(note);
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      for (const note of held.values()) noteOff(note);
    };
  }, []);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function hasShortcutModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}

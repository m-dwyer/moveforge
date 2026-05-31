import { useEffect } from "react";
import { useStore } from "@/store";
import { noteOff, noteOn } from "@/audio";
import { noteForPad } from "@/lib/pads";

// QWERTY → pad index (matches the legacy mapping). Use physical key codes so
// shifted punctuation or layout-specific key labels do not orphan note-offs.
export const KEY_CODE_TO_PAD: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyD: 3, KeyR: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyH: 8, KeyU: 9, KeyJ: 10, KeyI: 11, KeyK: 12, KeyO: 13, KeyL: 14, Semicolon: 15
};

export function useKeyboardPlay(): void {
  useEffect(() => {
    const held = new Map<string, { note: number; padIndex: number }>();

    const onDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (hasShortcutModifier(e)) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        useStore.getState().setPlaying(!useStore.getState().playing);
        return;
      }

      const padIndex = KEY_CODE_TO_PAD[e.code];
      if (padIndex === undefined) return;
      e.preventDefault();
      if (held.has(e.code)) return;

      const s = useStore.getState();
      const note = noteForPad(padIndex, {
        padLayout: s.padLayout,
        root: s.root,
        scale: s.scale,
        octave: s.octave
      });
      held.set(e.code, { note, padIndex });
      useStore.getState().setPadActive(padIndex, true);
      void noteOn(note, 0.94);
    };

    const onUp = (e: KeyboardEvent) => {
      const heldNote = held.get(e.code);
      if (heldNote === undefined) return;
      held.delete(e.code);
      useStore.getState().setPadActive(heldNote.padIndex, false);
      noteOff(heldNote.note);
    };

    const releaseHeld = () => {
      for (const heldNote of held.values()) {
        useStore.getState().setPadActive(heldNote.padIndex, false);
        noteOff(heldNote.note);
      }
      held.clear();
    };

    const onVisibilityChange = () => {
      if (document.hidden) releaseHeld();
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", releaseHeld);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", releaseHeld);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      releaseHeld();
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

import { useEffect } from "react";
import { useStore } from "@/store";
import { noteOff, noteOn } from "@/audio";
import { auditionEvent } from "@/audition-patterns";

// The audition sequencer engine. Mounted once at the app root so playback keeps
// running regardless of which view/component is currently visible — the mobile
// layout unmounts StepHarness when you switch tabs, so the interval must not live
// there. Reads all per-tick state via useStore.getState(); only re-subscribes on
// playing/tempo changes.
export function useSequencer() {
  const playing = useStore((s) => s.playing);
  const bpm = useStore((s) => s.bpm);
  const intervalMs = Math.max(20, Math.round(60_000 / (bpm * 4)));

  useEffect(() => {
    if (!playing) return;
    const noteOffTimers = new Set<number>();
    const activeNotes = new Set<number>();

    const tick = () => {
      const state = useStore.getState();
      const next = (state.playStep + 1) % state.audition.length;
      state.setPlayStep(next);
      const event = auditionEvent(state.audition.pattern, next, {
        steps: state.audition.pattern === "custom_copy" ? state.customCopySteps : state.steps,
        root: state.root,
        octave: state.octave,
        transpose: state.audition.transpose,
        velocity: state.audition.velocity
      });
      if (!event) return;

      if (activeNotes.has(event.note)) noteOff(event.note);
      activeNotes.add(event.note);
      void noteOn(event.note, event.velocity);
      const gateMs = Math.max(15, Math.round(intervalMs * Math.min(0.98, state.audition.gate) * event.gateSteps));
      const timer = window.setTimeout(() => {
        noteOff(event.note);
        activeNotes.delete(event.note);
        noteOffTimers.delete(timer);
      }, gateMs);
      noteOffTimers.add(timer);
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      clearInterval(id);
      for (const timer of noteOffTimers) clearTimeout(timer);
      for (const note of activeNotes) noteOff(note);
    };
  }, [playing, intervalMs]);
}

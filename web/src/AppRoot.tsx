import { useEffect } from "react";
import { useStore } from "@/store";
import { syncChain, reloadModuleWasm } from "@/audio";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Panel } from "@/components/Panel";
import { PadConfig } from "@/components/PadConfig";
import { PadGrid } from "@/components/PadGrid";
import { StepHarness } from "@/components/StepHarness";

export function AppRoot() {
  const initialize = useStore((s) => s.initialize);
  const moduleId = useStore((s) => s.moduleId);

  useEffect(() => {
    void initialize(moduleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Whenever the chain shape changes (modules picked, bypass toggled, track switched),
    // re-sync the engine. Param-only updates are sent directly from Controls.
    let prevChain = useStore.getState().tracks[useStore.getState().selectedTrack].chain;
    let prevTrack = useStore.getState().selectedTrack;
    return useStore.subscribe((state) => {
      const chain = state.tracks[state.selectedTrack].chain;
      if (chain === prevChain && state.selectedTrack === prevTrack) return;
      prevChain = chain;
      prevTrack = state.selectedTrack;
      void syncChain();
    });
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId: string | null }>).detail;
      void reloadModuleWasm(detail?.moduleId ?? null);
    };
    window.addEventListener("moveforge:wasm-rebuilt", handler);
    return () => window.removeEventListener("moveforge:wasm-rebuilt", handler);
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="mx-auto min-h-screen w-full max-w-3xl space-y-4 p-6">
        <Panel />
        <section className="space-y-3">
          <PadConfig />
          <PadGrid />
        </section>
        <StepHarness />
        <footer className="text-xs text-muted">
          Move emulator (knobs/transport/sequencer) lands later. Legacy app:{" "}
          <a className="text-accent underline" href="/web/legacy.html">/web/legacy.html</a>.
        </footer>
      </main>
    </TooltipProvider>
  );
}

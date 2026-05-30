import { useEffect } from "react";
import { useStore, selectSelectedSlot } from "@/store";
import { syncChain, reloadModuleWasm } from "@/audio";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Panel } from "@/components/Panel";
import { PadConfig } from "@/components/PadConfig";
import { PadGrid } from "@/components/PadGrid";
import { StepHarness } from "@/components/StepHarness";
import { useKeyboardPlay } from "@/lib/keyboard";

export function AppRoot() {
  const initialize = useStore((s) => s.initialize);
  const moduleId = useStore((s) => s.moduleId);
  const activeModuleName = useStore((s) => s.activeModuleName);
  const selectedTrack = useStore((s) => s.selectedTrack);
  const slot = useStore(selectSelectedSlot);
  const error = useStore((s) => s.error);
  const resetUiState = useStore((s) => s.resetUiState);

  useEffect(() => {
    void initialize(moduleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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

  useKeyboardPlay();

  return (
    <TooltipProvider delayDuration={200}>
      <main className="h-screen bg-bg text-text">
        <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-3 p-4">
          <header className="flex items-baseline justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold tracking-tight" data-testid="panel-title">{activeModuleName}</h1>
              <p className="text-xs text-muted">
                Track {selectedTrack + 1} / {slot.type}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetUiState();
                void initialize(initialModuleIdFromStore());
              }}
              className="rounded border border-line bg-panel-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-text"
            >
              Reset UI
            </button>
          </header>

          {error && (
            <div className="rounded border border-red-700 bg-red-950/40 px-3 py-1.5 text-sm text-red-200">{error}</div>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
            <section className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
              <Panel />
            </section>
            <section className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-1">
              <PadConfig />
              <PadGrid />
              <StepHarness />
            </section>
          </div>
        </div>
      </main>
    </TooltipProvider>
  );
}

function initialModuleIdFromStore(): string {
  return useStore.getState().moduleId;
}

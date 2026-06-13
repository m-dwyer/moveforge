import { useEffect, useState } from "react";
import { useStore, selectSelectedSlot } from "@/store";
import { hardPanic, setMasterVolume, syncChain, reloadModuleWasm } from "@/audio";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { Panel } from "@/components/Panel";
import { PadConfig } from "@/components/PadConfig";
import { PadGrid } from "@/components/PadGrid";
import { StepHarness } from "@/components/StepHarness";
import { MobileTabBar, type MobileTab } from "@/components/MobileTabBar";
import { useKeyboardPlay } from "@/lib/keyboard";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useSequencer } from "@/lib/useSequencer";

export function AppRoot() {
  const initialize = useStore((s) => s.initialize);
  const moduleId = useStore((s) => s.moduleId);
  const activeModuleName = useStore((s) => s.activeModuleName);
  const selectedTrack = useStore((s) => s.selectedTrack);
  const slot = useStore(selectSelectedSlot);
  const error = useStore((s) => s.error);
  const resetUiState = useStore((s) => s.resetUiState);
  const setPlaying = useStore((s) => s.setPlaying);
  const masterVolume = useStore((s) => s.masterVolume);
  const setMasterVolumeState = useStore((s) => s.setMasterVolume);
  const isDesktop = useIsDesktop();
  const [mobileTab, setMobileTab] = useState<MobileTab>("chain");

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
    setMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleId: string | null }>).detail;
      void reloadModuleWasm(detail?.moduleId ?? null);
    };
    window.addEventListener("moveforge:wasm-rebuilt", handler);
    return () => window.removeEventListener("moveforge:wasm-rebuilt", handler);
  }, []);

  useKeyboardPlay();
  useSequencer();

  return (
    <TooltipProvider delayDuration={200}>
      <main className="h-screen bg-bg text-text">
        <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-3 p-4">
          <header className="flex shrink-0 items-baseline justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold tracking-tight" data-testid="panel-title">{activeModuleName}</h1>
              <p className="text-xs text-muted">
                Track {selectedTrack + 1} / {slot.type}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="flex w-40 items-center gap-2 text-xs text-muted" title="Browser audition output level">
                Vol
                <Slider
                  value={[masterVolume]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(value) => setMasterVolumeState(value[0])}
                />
                <span className="w-8 text-right font-mono text-warn">{Math.round(masterVolume * 100)}</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  hardPanic();
                }}
                className="rounded border border-line bg-panel-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-red-500/60 hover:text-red-200"
                title="Stop all notes and clear audio FX tails"
              >
                Panic
              </button>
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
            </div>
          </header>

          {error && (
            <div className="shrink-0 rounded border border-red-700 bg-red-950/40 px-3 py-1.5 text-sm text-red-200">
              {error}
            </div>
          )}

          {isDesktop ? (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden">
              <section className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                <Panel />
              </section>
              <section className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-1">
                <PadConfig />
                <PadGrid />
                <StepHarness />
              </section>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
                {mobileTab === "chain" && <Panel sections={["track", "chain", "presets", "snapshots"]} />}
                {mobileTab === "params" && <Panel sections={["controls"]} />}
                {mobileTab === "play" && (
                  <>
                    <PadConfig />
                    <PadGrid rows={1} />
                  </>
                )}
                {mobileTab === "sequence" && <StepHarness />}
              </div>
              <MobileTabBar active={mobileTab} onChange={setMobileTab} />
            </div>
          )}
        </div>
      </main>
    </TooltipProvider>
  );
}

function initialModuleIdFromStore(): string {
  return useStore.getState().moduleId;
}

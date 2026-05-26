import { useEffect } from "react";
import { useStore } from "@/store";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Panel } from "@/components/Panel";

export function AppRoot() {
  const initialize = useStore((s) => s.initialize);
  const moduleId = useStore((s) => s.moduleId);

  useEffect(() => {
    void initialize(moduleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="mx-auto min-h-screen w-full max-w-3xl">
        <Panel />
        <footer className="px-6 py-4 text-xs text-muted">
          Left-side Move emulator lands in the next chunk. Legacy app:{" "}
          <a className="text-accent underline" href="/web/legacy.html">/web/legacy.html</a>.
        </footer>
      </main>
    </TooltipProvider>
  );
}

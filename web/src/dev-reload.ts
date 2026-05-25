// Subscribes to the dev server's SSE channel and broadcasts rebuild events.
// Loaded by index.html only when the dev server is running. Silent failure
// in production (EventSource will error and we just stop).

type RebuildEvent = {
  kind: "web" | "wasm";
  moduleId?: string | null;
};

if (typeof EventSource !== "undefined") {
  let consecutiveErrors = 0;
  const events = new EventSource("/__dev/events");

  events.addEventListener("rebuild", (event) => {
    consecutiveErrors = 0;
    let detail: RebuildEvent;
    try {
      detail = JSON.parse((event as MessageEvent).data) as RebuildEvent;
    } catch {
      return;
    }
    if (detail.kind === "web") {
      console.log("[dev-reload] web rebuild → reloading page");
      location.reload();
      return;
    }
    if (detail.kind === "wasm") {
      console.log(`[dev-reload] wasm rebuild${detail.moduleId ? ` for ${detail.moduleId}` : ""}`);
      window.dispatchEvent(new CustomEvent("moveforge:wasm-rebuilt", { detail }));
    }
  });

  events.onerror = () => {
    consecutiveErrors++;
    // Give up after ~10 failed reconnects (≈ several seconds) — server is gone.
    if (consecutiveErrors > 10) events.close();
  };
}

export {};

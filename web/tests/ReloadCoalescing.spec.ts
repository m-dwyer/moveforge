import { beforeEach, describe, expect, it, vi } from "vitest";

/* Drives the real web/src/audio.ts. The engine is replaced so the assertions
 * are about reload scheduling rather than about WASM or an AudioContext. */
const reloadSlot = vi.fn(async (_slotId: string) => {});
const loadedSlotIds = vi.fn((_moduleId?: string | null) => ["sound"]);

vi.mock("../src/audio-engine", () => ({
  AudioEngine: class {
    loadedSlotIds = loadedSlotIds;
    reloadSlot = reloadSlot;
  }
}));

const { reloadModuleWasm } = await import("../src/audio");

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

describe("reloadModuleWasm scheduling", () => {
  beforeEach(() => {
    reloadSlot.mockReset();
    reloadSlot.mockImplementation(async () => {});
    loadedSlotIds.mockReset();
    loadedSlotIds.mockReturnValue(["sound"]);
  });

  it("collapses a burst into the pass in flight plus one catch-up", async () => {
    /* The dev watcher fires per file event with no debounce (plan 5.5). Without
     * a guard each event started its own pass concurrently — five events over
     * three slots meant fifteen fetches and fifteen WebAssembly.instantiate
     * calls on the audio thread. */
    const gate = deferred();
    reloadSlot.mockImplementation(async () => {
      await gate.promise;
    });
    loadedSlotIds.mockReturnValue(["sound", "audio-fx-1", "audio-fx-2"]);

    const calls = [1, 2, 3, 4, 5].map(() => reloadModuleWasm("dustline"));
    gate.release();
    await Promise.all(calls);

    expect(reloadSlot).toHaveBeenCalledTimes(6); // 3 slots x (1 pass + 1 catch-up)
  });

  it("still runs a catch-up pass, so a build finishing mid-pass is not lost", async () => {
    /* Deduplicating outright would be wrong: the build that triggered the
     * second event may have finished after the in-flight pass already fetched,
     * which would leave the previous binary loaded. */
    const gate = deferred();
    reloadSlot.mockImplementation(async () => {
      await gate.promise;
    });

    const first = reloadModuleWasm("dustline");
    const second = reloadModuleWasm("dustline");
    gate.release();
    await Promise.all([first, second]);

    expect(reloadSlot).toHaveBeenCalledTimes(2);
  });

  it("does not make one module's reload wait on another's", async () => {
    const gate = deferred();
    reloadSlot.mockImplementation(async (slotId: string) => {
      if (slotId === "sound") await gate.promise;
    });
    loadedSlotIds.mockImplementation((moduleId?: string | null) =>
      moduleId === "dustline" ? ["sound"] : ["audio-fx-1"]
    );

    const blocked = reloadModuleWasm("dustline");
    await reloadModuleWasm("trail");
    expect(reloadSlot).toHaveBeenCalledWith("audio-fx-1");

    gate.release();
    await blocked;
  });

  it("sequential reloads each run a full pass", async () => {
    await reloadModuleWasm("dustline");
    await reloadModuleWasm("dustline");
    expect(reloadSlot).toHaveBeenCalledTimes(2);
  });

  it("keeps reloading the remaining slots when one throws, and does not reject", async () => {
    /* reloadSlot throws when a .wasm is missing, and web/wasm/ is gitignored,
     * so a fresh clone hits this. It used to abort the loop and surface as an
     * unhandled rejection from the `void reloadModuleWasm(...)` call site. */
    loadedSlotIds.mockReturnValue(["sound", "audio-fx-1"]);
    reloadSlot.mockImplementation(async (slotId: string) => {
      if (slotId === "sound") throw new Error("no wasm");
    });

    await expect(reloadModuleWasm("dustline")).resolves.toBeUndefined();
    expect(reloadSlot).toHaveBeenCalledWith("audio-fx-1");
  });
});

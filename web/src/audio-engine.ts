export type SlotKind = "midi_fx" | "sound_generator" | "audio_fx";

export type ChainSlotSpec = {
  slotId: string;
  moduleId: string;
  kind: SlotKind;
};

export type WorkletMessage = Record<string, unknown>;

export type MidiOutEvent = {
  slotId: string;
  status: number;
  d1: number;
  d2: number;
};

export type AudioEngineConfig = {
  workletUrl: string;
  processorName: string;
  onError: (slotId: string, message: string) => void;
  onSlotReady: (slotId: string, mode: "audio" | "midi_fx") => void;
  onMidiOut: (event: MidiOutEvent) => void;
};

// Legacy single-module options, retained for the current app.ts code path.
// Internally wraps a one-slot chain ({ slotId: "sound", kind: "sound_generator" }).
export type AudioEngineOptions = {
  moduleId: string;
  processorName: string;
  workletUrl: string;
  onReady: () => void;
  onError: (message: string) => void;
};

const SOUND_SLOT_ID = "sound";

type SlotEntry = {
  slotId: string;
  moduleId: string;
  kind: SlotKind;
  node: AudioWorkletNode;
  ready: boolean;
};

export class AudioEngine {
  #audio: AudioContext | null = null;
  #workletUrl: string | null = null;
  #processorName: string | null = null;
  #config: AudioEngineConfig | null = null;
  #slots: Map<string, SlotEntry> = new Map();
  #audioOrder: string[] = []; // sound_generator + audio_fx slots, in chain order
  #scheduleSink: GainNode | null = null; // muted sink that keeps midi_fx nodes processing

  get ready(): boolean {
    if (this.#slots.size === 0) return false;
    for (const slot of this.#slots.values()) if (!slot.ready) return false;
    return true;
  }

  // Legacy accessor. Returns the sound_generator's moduleId, or null.
  get moduleId(): string | null {
    return this.#slots.get(SOUND_SLOT_ID)?.moduleId ?? null;
  }

  getSlotModuleId(slotId: string): string | null {
    return this.#slots.get(slotId)?.moduleId ?? null;
  }

  hasSlot(slotId: string): boolean {
    return this.#slots.has(slotId);
  }

  // -- legacy single-module surface (used by the current app.ts) -----------

  async enable(options: AudioEngineOptions): Promise<void> {
    const config: AudioEngineConfig = {
      workletUrl: options.workletUrl,
      processorName: options.processorName,
      onError: (_slotId, message) => options.onError(message),
      onSlotReady: (slotId) => {
        if (slotId === SOUND_SLOT_ID && this.ready) options.onReady();
      },
      onMidiOut: () => {}
    };
    await this.enableChain(
      [{ slotId: SOUND_SLOT_ID, moduleId: options.moduleId, kind: "sound_generator" }],
      config
    );
  }

  send(message: WorkletMessage): void {
    this.sendToSlot(SOUND_SLOT_ID, message);
  }

  async reload(): Promise<void> {
    await this.reloadSlot(SOUND_SLOT_ID);
  }

  // -- chain surface -------------------------------------------------------

  async enableChain(slots: ChainSlotSpec[], config: AudioEngineConfig): Promise<void> {
    if (!this.#audio) await this.#startContext(config);
    this.#config = config;
    await this.#audio!.resume();

    const desired = new Map(slots.map((s) => [s.slotId, s]));
    for (const slotId of Array.from(this.#slots.keys())) {
      if (!desired.has(slotId)) this.#disposeSlot(slotId);
    }

    for (const spec of slots) {
      const existing = this.#slots.get(spec.slotId);
      if (existing && existing.moduleId === spec.moduleId && existing.kind === spec.kind) continue;
      if (existing) this.#disposeSlot(spec.slotId);
      await this.#createSlot(spec);
    }

    this.#rewire(slots);
  }

  async replaceSlot(slotId: string, spec: ChainSlotSpec): Promise<void> {
    if (slotId !== spec.slotId) throw new Error(`replaceSlot id mismatch: ${slotId} vs ${spec.slotId}`);
    if (!this.#audio || !this.#config) throw new Error("AudioEngine not enabled yet");
    const existing = this.#slots.get(slotId);
    if (existing && existing.moduleId === spec.moduleId && existing.kind === spec.kind) return;
    if (existing) this.#disposeSlot(slotId);
    await this.#createSlot(spec);
    this.#rewireFromCurrentOrder();
  }

  removeSlot(slotId: string): void {
    if (!this.#slots.has(slotId)) return;
    this.#disposeSlot(slotId);
    this.#rewireFromCurrentOrder();
  }

  setChainOrder(slotIds: string[]): void {
    // Reorder existing audio slots without recreating them.
    const known = slotIds.filter((id) => {
      const slot = this.#slots.get(id);
      return slot && (slot.kind === "sound_generator" || slot.kind === "audio_fx");
    });
    this.#audioOrder = known;
    this.#rewireFromCurrentOrder();
  }

  sendToSlot(slotId: string, message: WorkletMessage): void {
    const slot = this.#slots.get(slotId);
    slot?.node.port.postMessage(message);
  }

  sendToAll(message: WorkletMessage): void {
    for (const slot of this.#slots.values()) slot.node.port.postMessage(message);
  }

  async reloadSlot(slotId: string): Promise<void> {
    const slot = this.#slots.get(slotId);
    if (!slot) return;
    await this.#loadWasmInto(slot);
  }

  async reloadAll(): Promise<void> {
    for (const slotId of Array.from(this.#slots.keys())) await this.reloadSlot(slotId);
  }

  // -- internals -----------------------------------------------------------

  async #startContext(config: AudioEngineConfig): Promise<void> {
    const audio = new AudioContext({ sampleRate: 44100 });
    const loadedWorkletUrl = new URL(config.workletUrl, window.location.href);
    loadedWorkletUrl.searchParams.set("v", String(Date.now()));
    await audio.audioWorklet.addModule(loadedWorkletUrl.toString());
    this.#audio = audio;
    this.#workletUrl = config.workletUrl;
    this.#processorName = config.processorName;
    this.#scheduleSink = audio.createGain();
    this.#scheduleSink.gain.value = 0;
    this.#scheduleSink.connect(audio.destination);
  }

  async #createSlot(spec: ChainSlotSpec): Promise<void> {
    if (!this.#audio || !this.#processorName || !this.#config) throw new Error("AudioEngine not initialized");
    const node = new AudioWorkletNode(this.#audio, this.#processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    const entry: SlotEntry = { ...spec, node, ready: false };
    const config = this.#config;
    node.port.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;
      if (data.type === "ready") {
        entry.ready = true;
        config.onSlotReady(entry.slotId, data.mode === "midi_fx" ? "midi_fx" : "audio");
      } else if (data.type === "error") {
        config.onError(entry.slotId, String(data.message ?? "Audio failed"));
      } else if (data.type === "midiOut") {
        config.onMidiOut({
          slotId: entry.slotId,
          status: Number(data.status) & 0xFF,
          d1: Number(data.d1) & 0x7F,
          d2: Number(data.d2) & 0x7F
        });
      }
    };
    this.#slots.set(spec.slotId, entry);
    await this.#loadWasmInto(entry);
  }

  async #loadWasmInto(entry: SlotEntry): Promise<void> {
    const wasmResponse = await fetch(`/web/wasm/${entry.moduleId}.wasm`, { cache: "no-store" });
    if (!wasmResponse.ok) {
      this.#config?.onError(entry.slotId, `Could not load audio module: ${wasmResponse.status}`);
      throw new Error(`Could not load audio module: ${wasmResponse.status}`);
    }
    const wasmBytes = await wasmResponse.arrayBuffer();
    entry.ready = false;
    entry.node.port.postMessage({ type: "loadWasm", bytes: wasmBytes }, [wasmBytes]);
  }

  #disposeSlot(slotId: string): void {
    const slot = this.#slots.get(slotId);
    if (!slot) return;
    try { slot.node.disconnect(); } catch { /* ignore */ }
    slot.node.port.onmessage = null;
    this.#slots.delete(slotId);
    this.#audioOrder = this.#audioOrder.filter((id) => id !== slotId);
  }

  #rewire(slots: ChainSlotSpec[]): void {
    // Compute audio chain order from the spec (sound_generator + audio_fx in spec order).
    this.#audioOrder = slots
      .filter((s) => s.kind === "sound_generator" || s.kind === "audio_fx")
      .map((s) => s.slotId);
    this.#rewireFromCurrentOrder();
  }

  #rewireFromCurrentOrder(): void {
    if (!this.#audio || !this.#scheduleSink) return;
    // Disconnect everything first so we can rewire from scratch.
    for (const slot of this.#slots.values()) {
      try { slot.node.disconnect(); } catch { /* ignore */ }
    }
    // Audio chain: connect audioOrder[i] -> audioOrder[i+1], last -> destination.
    const order = this.#audioOrder.filter((id) => this.#slots.has(id));
    for (let i = 0; i < order.length - 1; i++) {
      const a = this.#slots.get(order[i])!.node;
      const b = this.#slots.get(order[i + 1])!.node;
      a.connect(b);
    }
    if (order.length > 0) {
      this.#slots.get(order[order.length - 1])!.node.connect(this.#audio.destination);
    }
    // midi_fx slots: route to the muted sink so process() keeps running for tick scheduling.
    for (const slot of this.#slots.values()) {
      if (slot.kind === "midi_fx") slot.node.connect(this.#scheduleSink);
    }
  }
}

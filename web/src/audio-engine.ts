export type AudioEngineOptions = {
  moduleId: string;
  onError: (message: string) => void;
  onReady: () => void;
  processorName: string;
  workletUrl: string;
};

export type WorkletMessage = Record<string, unknown>;

export class AudioEngine {
  #audio: AudioContext | null = null;
  #moduleId: string | null = null;
  #node: AudioWorkletNode | null = null;
  #ready = false;

  get ready(): boolean {
    return this.#ready;
  }

  async enable(options: AudioEngineOptions): Promise<void> {
    if (this.#ready && this.#audio && this.#moduleId === options.moduleId) {
      await this.#audio.resume();
      return;
    }

    if (!this.#audio || !this.#node) await this.#startWorklet(options);
    await this.#audio?.resume();
    await this.#loadModule(options.moduleId);
  }

  async #startWorklet(options: AudioEngineOptions): Promise<void> {
    const audio = new AudioContext({ sampleRate: 44100 });
    const loadedWorkletUrl = new URL(options.workletUrl, window.location.href);
    loadedWorkletUrl.searchParams.set("v", String(Date.now()));
    await audio.audioWorklet.addModule(loadedWorkletUrl.toString());

    const node = new AudioWorkletNode(audio, options.processorName, {
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    node.connect(audio.destination);
    node.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === "ready") {
        this.#ready = true;
        options.onReady();
      } else if (event.data?.type === "error") {
        options.onError(String(event.data.message ?? "Audio failed"));
      }
    };

    this.#audio = audio;
    this.#node = node;
  }

  async #loadModule(moduleId: string): Promise<void> {
    if (!this.#node) throw new Error("Audio worklet is not ready");
    const wasmResponse = await fetch(`/web/wasm/${moduleId}.wasm`, { cache: "no-store" });
    if (!wasmResponse.ok) throw new Error(`Could not load audio module: ${wasmResponse.status}`);
    const wasmBytes = await wasmResponse.arrayBuffer();
    this.#ready = false;
    this.#moduleId = moduleId;
    this.#node.port.postMessage({ type: "loadWasm", bytes: wasmBytes }, [wasmBytes]);
  }

  send(message: WorkletMessage): void {
    this.#node?.port.postMessage(message);
  }
}

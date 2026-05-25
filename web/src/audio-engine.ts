export type WrapperVariant = "wasm" | "schwung";

export type AudioEngineOptions = {
  moduleId: string;
  onError: (message: string) => void;
  onReady: () => void;
  processorName: string;
  workletUrl: string;
  wrapper?: WrapperVariant;
};

export type WorkletMessage = Record<string, unknown>;

export class AudioEngine {
  #audio: AudioContext | null = null;
  #moduleId: string | null = null;
  #wrapper: WrapperVariant = "wasm";
  #node: AudioWorkletNode | null = null;
  #ready = false;

  get ready(): boolean {
    return this.#ready;
  }

  get wrapper(): WrapperVariant {
    return this.#wrapper;
  }

  async enable(options: AudioEngineOptions): Promise<void> {
    const wrapper = options.wrapper ?? "wasm";
    if (this.#ready && this.#audio && this.#moduleId === options.moduleId && this.#wrapper === wrapper) {
      await this.#audio.resume();
      return;
    }

    if (!this.#audio || !this.#node) await this.#startWorklet(options);
    await this.#audio?.resume();
    await this.#loadModule(options.moduleId, wrapper);
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

  async #loadModule(moduleId: string, wrapper: WrapperVariant): Promise<void> {
    if (!this.#node) throw new Error("Audio worklet is not ready");
    const suffix = wrapper === "schwung" ? "-schwung" : "";
    const wasmResponse = await fetch(`/web/wasm/${moduleId}${suffix}.wasm`, { cache: "no-store" });
    if (!wasmResponse.ok) throw new Error(`Could not load audio module: ${wasmResponse.status}`);
    const wasmBytes = await wasmResponse.arrayBuffer();
    this.#ready = false;
    this.#moduleId = moduleId;
    this.#wrapper = wrapper;
    this.#node.port.postMessage({ type: "loadWasm", bytes: wasmBytes }, [wasmBytes]);
  }

  send(message: WorkletMessage): void {
    this.#node?.port.postMessage(message);
  }

  async reload(): Promise<void> {
    if (!this.#node || !this.#moduleId) return;
    await this.#loadModule(this.#moduleId, this.#wrapper);
  }

  get moduleId(): string | null {
    return this.#moduleId;
  }
}

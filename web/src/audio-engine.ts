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
  #node: AudioWorkletNode | null = null;
  #ready = false;

  get ready(): boolean {
    return this.#ready;
  }

  async enable(options: AudioEngineOptions): Promise<void> {
    if (this.#ready && this.#audio) {
      await this.#audio.resume();
      return;
    }

    const wasmResponse = await fetch(`wasm/${options.moduleId}.wasm`, { cache: "no-store" });
    if (!wasmResponse.ok) throw new Error(`Could not load WASM: ${wasmResponse.status}`);
    const wasmBytes = await wasmResponse.arrayBuffer();

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
      if (event.data?.type === "needWasm") {
        node.port.postMessage({ type: "loadWasm", bytes: wasmBytes }, [wasmBytes]);
      } else if (event.data?.type === "ready") {
        this.#ready = true;
        options.onReady();
      } else if (event.data?.type === "error") {
        options.onError(String(event.data.message ?? "Audio failed"));
      }
    };

    this.#audio = audio;
    this.#node = node;
  }

  send(message: WorkletMessage): void {
    this.#node?.port.postMessage(message);
  }
}

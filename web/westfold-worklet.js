const PARAM_IDS = {
  volume: 0,
  ratio: 1,
  fm: 2,
  fold: 3,
  lpg: 4,
  decay: 5,
  release: 6,
  bend_range: 7
};

class WestfoldProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.exports = null;
    this.left = null;
    this.right = null;
    this.queue = [];
    this.audioFx = {
      enabled: false,
      drive: 0.35,
      tone: 0.72,
      wet: 0.55,
      lpL: 0,
      lpR: 0
    };

    this.port.onmessage = (event) => {
      if (event.data?.type === "loadWasm") {
        this.load(event.data.bytes);
        return;
      }
      if (!this.ready) {
        this.queue.push(event.data);
        return;
      }
      this.handle(event.data);
    };

    this.port.postMessage({ type: "needWasm" });
  }

  async load(bytes) {
    try {
      const module = await WebAssembly.instantiate(bytes, {});
      this.exports = module.instance.exports;
      this.exports.wf_init();
      this.left = new Float32Array(this.exports.memory.buffer, this.exports.wf_left_ptr(), 128);
      this.right = new Float32Array(this.exports.memory.buffer, this.exports.wf_right_ptr(), 128);
      this.ready = true;
      this.queue.splice(0).forEach((message) => this.handle(message));
      this.port.postMessage({ type: "ready" });
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error?.message || error) });
    }
  }

  handle(message) {
    if (!message || !this.exports) return;
    if (message.type === "param") {
      const id = PARAM_IDS[message.key];
      if (id !== undefined) this.exports.wf_set_param(id, Number(message.value));
    } else if (message.type === "noteOn") {
      this.exports.wf_note_on(Number(message.note), Number(message.velocity));
    } else if (message.type === "noteOff") {
      this.exports.wf_note_off(Number(message.note));
    } else if (message.type === "allNotesOff") {
      this.exports.wf_all_notes_off();
    } else if (message.type === "pitchBend") {
      this.exports.wf_set_pitch_bend(Number(message.value));
    } else if (message.type === "audioFx") {
      this.audioFx.enabled = Boolean(message.enabled);
      this.audioFx.drive = Math.min(1, Math.max(0, Number(message.drive ?? this.audioFx.drive)));
      this.audioFx.tone = Math.min(1, Math.max(0, Number(message.tone ?? this.audioFx.tone)));
      this.audioFx.wet = Math.min(1, Math.max(0, Number(message.wet ?? this.audioFx.wet)));
    }
  }

  processAudioFx(left, right, frames) {
    if (!this.audioFx.enabled) return;
    const gain = 1 + this.audioFx.drive * 18;
    const wet = this.audioFx.wet;
    const alpha = 0.015 + this.audioFx.tone * 0.65;
    for (let i = 0; i < frames; i++) {
      const dryL = left[i];
      const dryR = right[i];
      const drivenL = Math.tanh(dryL * gain);
      const drivenR = Math.tanh(dryR * gain);
      this.audioFx.lpL += alpha * (drivenL - this.audioFx.lpL);
      this.audioFx.lpR += alpha * (drivenR - this.audioFx.lpR);
      left[i] = dryL * (1 - wet) + this.audioFx.lpL * wet;
      right[i] = dryR * (1 - wet) + this.audioFx.lpR * wet;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    if (!this.ready) {
      output[0].fill(0);
      output[1].fill(0);
      return true;
    }

    this.exports.wf_render(output[0].length);
    output[0].set(this.left.subarray(0, output[0].length));
    output[1].set(this.right.subarray(0, output[1].length));
    this.processAudioFx(output[0], output[1], output[0].length);
    return true;
  }
}

registerProcessor("westfold-processor", WestfoldProcessor);

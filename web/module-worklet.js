class ModuleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.exports = null;
    this.mode = null;
    this.render = null;
    this.inLeft = null;
    this.inRight = null;
    this.left = null;
    this.right = null;
    this.keyBuf = null;
    this.valBuf = null;
    this.queue = [];
    this.soundBypassed = false;

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
      const memory = this.exports.memory.buffer;

      if (typeof this.exports.sch_init === "function") {
        this.mode = "schwung";
        this.exports.sch_init();
        this.left = new Float32Array(memory, this.exports.sch_left_ptr(), 128);
        this.right = new Float32Array(memory, this.exports.sch_right_ptr(), 128);
        this.keyBuf = new Uint8Array(memory, this.exports.sch_key_buf(), this.exports.sch_key_buf_size());
        this.valBuf = new Uint8Array(memory, this.exports.sch_val_buf(), this.exports.sch_val_buf_size());
        this.render = this.exports.sch_render;
      } else {
        this.mode = "wasm";
        this.exports.mf_init();
        this.left = new Float32Array(memory, this.exports.mf_left_ptr(), 128);
        this.right = new Float32Array(memory, this.exports.mf_right_ptr(), 128);
        if (typeof this.exports.mf_in_left_ptr === "function") {
          this.inLeft = new Float32Array(memory, this.exports.mf_in_left_ptr(), 128);
          this.inRight = new Float32Array(memory, this.exports.mf_in_right_ptr(), 128);
        }
        this.render = this.exports.mf_render;
      }

      this.ready = true;
      this.queue.splice(0).forEach((message) => this.handle(message));
      this.port.postMessage({ type: "ready", mode: this.mode });
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error?.message || error) });
    }
  }

  writeCString(buf, value) {
    if (!buf) return;
    const enc = new TextEncoder().encode(String(value));
    const max = buf.length - 1;
    const n = enc.length < max ? enc.length : max;
    buf.set(enc.subarray(0, n));
    buf[n] = 0;
  }

  handle(message) {
    if (!message || !this.exports) return;
    if (message.type === "param") {
      if (this.mode === "schwung") {
        if (typeof message.key !== "string") return;
        this.writeCString(this.keyBuf, message.key);
        this.writeCString(this.valBuf, Number(message.value).toFixed(6));
        this.exports.sch_set_param();
      } else {
        if (!Number.isInteger(message.id)) return;
        this.exports.mf_set_param(message.id, Number(message.value));
      }
    } else if (message.type === "noteOn") {
      const note = Number(message.note);
      if (this.mode === "schwung") {
        const vel = Math.max(0, Math.min(127, Math.round(Number(message.velocity) * 127)));
        this.exports.sch_midi(0x90, note, vel);
      } else if (typeof this.exports.mf_note_on === "function") {
        this.exports.mf_note_on(note, Number(message.velocity));
      }
    } else if (message.type === "noteOff") {
      const note = Number(message.note);
      if (this.mode === "schwung") {
        this.exports.sch_midi(0x80, note, 0);
      } else if (typeof this.exports.mf_note_off === "function") {
        this.exports.mf_note_off(note);
      }
    } else if (message.type === "allNotesOff") {
      if (this.mode === "schwung") {
        this.writeCString(this.keyBuf, "all_notes_off");
        this.writeCString(this.valBuf, "1");
        this.exports.sch_set_param();
      } else if (typeof this.exports.mf_all_notes_off === "function") {
        this.exports.mf_all_notes_off();
      }
    } else if (message.type === "pitchBend") {
      const bend = Number(message.value);
      if (this.mode === "schwung") {
        const b = Math.max(0, Math.min(16383, Math.round((bend + 1) * 8192)));
        this.exports.sch_midi(0xE0, b & 0x7F, (b >> 7) & 0x7F);
      } else if (typeof this.exports.mf_set_pitch_bend === "function") {
        this.exports.mf_set_pitch_bend(bend);
      }
    } else if (message.type === "soundBypass") {
      this.soundBypassed = Boolean(message.bypassed);
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    if (!this.ready) {
      output[0].fill(0);
      output[1].fill(0);
      return true;
    }

    const frames = output[0].length;

    // Feed available input (e.g. mic / upstream node) into the module's
    // input buffers. Sound generators ignore these; audio FX read them.
    if (this.inLeft) {
      const input = inputs[0];
      if (input && input.length >= 1) {
        this.inLeft.set(input[0].subarray(0, frames));
        this.inRight.set(input.length > 1 ? input[1].subarray(0, frames) : input[0].subarray(0, frames));
      } else {
        this.inLeft.fill(0);
        this.inRight.fill(0);
      }
    }

    this.render(frames);
    output[0].set(this.left.subarray(0, frames));
    output[1].set(this.right.subarray(0, frames));
    if (this.soundBypassed) {
      output[0].fill(0);
      output[1].fill(0);
    }
    return true;
  }
}

registerProcessor("module-processor", ModuleProcessor);

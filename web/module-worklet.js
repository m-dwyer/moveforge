class ModuleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.exports = null;
    this.mode = null; // "audio" (sch_*) | "midi_fx" (mf_*)
    this.inLeft = null;
    this.inRight = null;
    this.left = null;
    this.right = null;
    this.keyBuf = null;
    this.valBuf = null;
    this.outBuf = null;
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

      this.ready = false;
      this.left = this.right = this.inLeft = this.inRight = null;
      this.keyBuf = this.valBuf = this.outBuf = null;

      if (typeof this.exports.mf_init === "function") {
        this.mode = "midi_fx";
        this.exports.mf_init();
        this.keyBuf = new Uint8Array(memory, this.exports.mf_key_buf(), this.exports.mf_key_buf_size());
        this.valBuf = new Uint8Array(memory, this.exports.mf_val_buf(), this.exports.mf_val_buf_size());
        this.outBuf = new Uint8Array(memory, this.exports.mf_out_buf_ptr(), this.exports.mf_out_buf_size());
      } else if (typeof this.exports.sch_init === "function") {
        this.mode = "audio";
        this.exports.sch_init();
        this.left = new Float32Array(memory, this.exports.sch_left_ptr(), 128);
        this.right = new Float32Array(memory, this.exports.sch_right_ptr(), 128);
        this.inLeft = new Float32Array(memory, this.exports.sch_in_left_ptr(), 128);
        this.inRight = new Float32Array(memory, this.exports.sch_in_right_ptr(), 128);
        this.keyBuf = new Uint8Array(memory, this.exports.sch_key_buf(), this.exports.sch_key_buf_size());
        this.valBuf = new Uint8Array(memory, this.exports.sch_val_buf(), this.exports.sch_val_buf_size());
      } else {
        throw new Error("WASM exports neither sch_init nor mf_init");
      }

      this.ready = true;
      this.queue.splice(0).forEach((message) => this.handle(message));
      this.port.postMessage({ type: "ready", mode: this.mode });
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error?.message || error) });
    }
  }

  writeCString(buf, value) {
    // AudioWorkletGlobalScope does not expose TextEncoder in some browsers,
    // so manually copy ASCII bytes. Param keys and stringified float values
    // are always ASCII; replace anything else with '?'.
    if (!buf) return;
    const s = String(value);
    const max = buf.length - 1;
    let n = 0;
    for (let i = 0; i < s.length && n < max; i++) {
      const code = s.charCodeAt(i);
      buf[n++] = code < 0x80 ? code : 0x3F;
    }
    buf[n] = 0;
  }

  emitOutgoingMidi(count) {
    if (!count || !this.outBuf) return;
    const max = Math.min(count, Math.floor(this.outBuf.length / 3));
    for (let i = 0; i < max; i++) {
      const status = this.outBuf[i * 3];
      const d1 = this.outBuf[i * 3 + 1];
      const d2 = this.outBuf[i * 3 + 2];
      this.port.postMessage({ type: "midiOut", status, d1, d2 });
    }
  }

  handle(message) {
    if (!message || !this.exports) return;
    if (this.mode === "midi_fx") {
      if (message.type === "param") {
        if (typeof message.key !== "string") return;
        this.writeCString(this.keyBuf, message.key);
        this.writeCString(this.valBuf, Number(message.value).toFixed(6));
        this.exports.mf_set_param();
      } else if (message.type === "midiIn") {
        const status = Number(message.status) & 0xFF;
        const d1 = Number(message.d1) & 0x7F;
        const d2 = Number(message.d2) & 0x7F;
        const n = this.exports.mf_process_midi_byte(status, d1, d2);
        this.emitOutgoingMidi(n);
      } else if (message.type === "noteOn") {
        const note = Number(message.note) & 0x7F;
        const vel = Math.max(0, Math.min(127, Math.round(Number(message.velocity) * 127)));
        const n = this.exports.mf_process_midi_byte(0x90, note, vel);
        this.emitOutgoingMidi(n);
      } else if (message.type === "noteOff") {
        const note = Number(message.note) & 0x7F;
        const n = this.exports.mf_process_midi_byte(0x80, note, 0);
        this.emitOutgoingMidi(n);
      }
      return;
    }

    // audio mode (sch_*)
    if (message.type === "param") {
      if (typeof message.key !== "string") return;
      this.writeCString(this.keyBuf, message.key);
      this.writeCString(this.valBuf, Number(message.value).toFixed(6));
      this.exports.sch_set_param();
    } else if (message.type === "noteOn") {
      const note = Number(message.note);
      const vel = Math.max(0, Math.min(127, Math.round(Number(message.velocity) * 127)));
      this.exports.sch_midi(0x90, note, vel);
    } else if (message.type === "noteOff") {
      const note = Number(message.note);
      this.exports.sch_midi(0x80, note, 0);
    } else if (message.type === "midiIn") {
      const status = Number(message.status) & 0xFF;
      const d1 = Number(message.d1) & 0x7F;
      const d2 = Number(message.d2) & 0x7F;
      this.exports.sch_midi(status, d1, d2);
    } else if (message.type === "allNotesOff") {
      this.writeCString(this.keyBuf, "all_notes_off");
      this.writeCString(this.valBuf, "1");
      this.exports.sch_set_param();
    } else if (message.type === "pitchBend") {
      const bend = Number(message.value);
      const b = Math.max(0, Math.min(16383, Math.round((bend + 1) * 8192)));
      this.exports.sch_midi(0xE0, b & 0x7F, (b >> 7) & 0x7F);
    } else if (message.type === "soundBypass") {
      this.soundBypassed = Boolean(message.bypassed);
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const frames = output[0].length;

    if (this.mode === "midi_fx") {
      // No audio output; emit silence so downstream nodes get a clean signal.
      // Run the periodic tick so time-based MIDI (arp, clock) can be emitted.
      output[0].fill(0);
      output[1].fill(0);
      if (this.ready) {
        const n = this.exports.mf_tick(frames);
        this.emitOutgoingMidi(n);
      }
      return true;
    }

    if (!this.ready) {
      output[0].fill(0);
      output[1].fill(0);
      return true;
    }

    // Always feed inputs[0] into the module's input buffers. Sound generators
    // ignore them (their Schwung wrapper passes NULL to process_float);
    // audio FX modules read them.
    const input = inputs[0];
    if (input && input.length >= 1) {
      this.inLeft.set(input[0].subarray(0, frames));
      this.inRight.set(input.length > 1 ? input[1].subarray(0, frames) : input[0].subarray(0, frames));
    } else {
      this.inLeft.fill(0);
      this.inRight.fill(0);
    }

    this.exports.sch_render(frames);
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

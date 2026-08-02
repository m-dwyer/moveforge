/**
 * Compiler flag sets, in one place.
 *
 * These used to be spelled out longhand in build.sh, build-host.sh, test.sh and
 * render-demo.sh, which meant four copies that differed in ways no reader could
 * tell were deliberate. Naming each set makes the differences legible: -Werror is
 * on for tests and off for render binaries (a harness warning should not block an
 * audition), the cross build is the only one that tunes for Cortex-A72, and the
 * sanitizer pass drops to -O1 because that is where GCC's range analysis differs
 * from -O2 (see scripts/check-gcc.sh for what that cost us).
 *
 * A variant id is also an object directory, so two variants never share a .o —
 * sharing one would mean sharing its flags.
 */

/** Which ninja file a variant's targets land in, and therefore where it runs. */
export type ToolchainId = "host" | "cross" | "wasm";

export type Variant = {
  id: string;
  toolchain: ToolchainId;
  /** Compile flags, excluding includes and the depfile flags ninja adds. */
  cflags: string[];
  /** Link flags, appended after the objects. */
  ldflags: string[];
  shared?: boolean;
};

const WARNINGS = ["-Wall", "-Wextra"];

export const SANITIZER_FLAGS = [
  "-fsanitize=address,undefined",
  "-fno-omit-frame-pointer",
  "-fno-sanitize-recover=all"
];

/** C tests: -Werror, because a warning in a test is a defect we can fix now. */
export const TEST_VARIANT: Variant = {
  id: "test",
  toolchain: "host",
  cflags: ["-std=c11", "-O2", "-g", ...WARNINGS, "-Werror"],
  ldflags: ["-lm"]
};

/**
 * Second test pass under AddressSanitizer + UndefinedBehaviorSanitizer.
 *
 * Worth the ~2x runtime here specifically: the modules carry fixed-size ring
 * buffers indexed by computed offsets (lobber's masked 1<<19 buffers, trail's
 * delay lines), Faust adapters write through zone pointers held in hand-sized
 * arrays, and there are float->int conversions at every audio boundary. Those
 * are exactly ASan/UBSan's targets, and none of them are visible to a plain -O2
 * build or to the metric checks.
 */
export const TEST_SAN_VARIANT: Variant = {
  id: "test-san",
  toolchain: "host",
  cflags: ["-std=c11", "-O1", "-g", ...WARNINGS, "-Werror", ...SANITIZER_FLAGS],
  ldflags: [...SANITIZER_FLAGS, "-lm"]
};

/** Offline render/trace harnesses. No -Werror: these are audition tools. */
export const RENDER_VARIANT: Variant = {
  id: "render",
  toolchain: "host",
  cflags: [
    "-std=c11",
    "-O2",
    "-g",
    ...WARNINGS,
    "-D_POSIX_C_SOURCE=200809L",
    "-DMOVEFORGE_COUNT_NONFINITE"
  ],
  ldflags: ["-lm"]
};

/** Host-only shared library, for local compile sanity and the offline hosts. */
export const HOST_LIB_VARIANT: Variant = {
  id: "hostlib",
  toolchain: "host",
  cflags: ["-std=c11", "-O3", "-g", ...WARNINGS, "-fPIC"],
  ldflags: ["-lm"],
  shared: true
};

/**
 * The aarch64 device build.
 *
 * Move is a Raspberry Pi CM4: BCM2711, 4x Cortex-A72 @ 1.5 GHz. -march stays at
 * the ARMv8 baseline so the .so keeps running anywhere ARMv8, while -mtune lets
 * the scheduler assume an out-of-order 3-wide A72 rather than a conservative
 * default. Matches what schwung's own build notes use.
 */
export const MOVE_VARIANT: Variant = {
  id: "move",
  toolchain: "cross",
  cflags: ["-std=c11", "-O3", "-g", ...WARNINGS, "-march=armv8-a", "-mtune=cortex-a72", "-fPIC"],
  ldflags: ["-lm"],
  shared: true
};

/** Browser build. Link flags are per-module (the export list), so not here. */
export const WASM_VARIANT: Variant = {
  id: "wasm",
  toolchain: "wasm",
  cflags: ["-O3", ...WARNINGS],
  ldflags: []
};

/**
 * Shared sch_* ABI for sound generators and audio FX. Sound generators use a
 * subset (note handlers via sch_midi); both expose sch_in_* so the worklet can
 * use one input-feed code path.
 */
export const SCH_EXPORTS = [
  "_sch_init",
  "_sch_set_param",
  "_sch_midi",
  "_sch_render",
  "_sch_in_left_ptr",
  "_sch_in_right_ptr",
  "_sch_left_ptr",
  "_sch_right_ptr",
  "_sch_key_buf",
  "_sch_val_buf",
  "_sch_key_buf_size",
  "_sch_val_buf_size"
];

/**
 * midi_fx ABI. No audio I/O. Inbound MIDI via mf_process_midi_byte; periodic
 * emit via mf_tick. Both return emitted count; bytes are read from mf_out_buf_ptr
 * (3 bytes per message, status/d1/d2).
 */
export const MF_EXPORTS = [
  "_mf_init",
  "_mf_set_param",
  "_mf_process_midi_byte",
  "_mf_tick",
  "_mf_out_buf_ptr",
  "_mf_out_buf_size",
  "_mf_key_buf",
  "_mf_val_buf",
  "_mf_key_buf_size",
  "_mf_val_buf_size"
];

/** The emcc link flags for a standalone wasm module exporting `exports`. */
export function wasmLinkFlags(exports: string[]): string[] {
  return [
    "-s",
    "STANDALONE_WASM=1",
    "-s",
    `EXPORTED_FUNCTIONS=[${exports.map((name) => `"${name}"`).join(",")}]`,
    "-Wl,--no-entry"
  ];
}

/** Default container images, overridable the same way the bash scripts allowed. */
export const CROSS_IMAGE = process.env.IMAGE_NAME || "schwung-module-builder";
export const EMSCRIPTEN_IMAGE = process.env.EMSCRIPTEN_IMAGE || "moveforge-emsdk";
export const CROSS_PREFIX = process.env.CROSS_PREFIX || "aarch64-linux-gnu-";

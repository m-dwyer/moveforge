import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

/**
 * Loads a module's generated ui_chain.js into a sandbox so its on-device
 * behavior can be tested locally, without the Move. The chain UI is plain JS
 * that imports the Schwung shared modules and calls host drawing globals; we
 * strip the (device-path) imports, inject mocks for everything it references,
 * run it, and capture globalThis.chain_ui plus every drawing call it makes.
 */

export type DrawCall = { op: string; args: number[] };

export type ChainUi = {
  init: () => void;
  tick: () => void;
  onMidiMessageInternal?: (data: number[]) => void;
};

export type LoadedChainUi = {
  ui: ChainUi;
  draws: DrawCall[];
  /** Set what host_module_get_param returns for a key (null = absent). */
  setParam: (key: string, value: string | null) => void;
  /** Forget recorded draw calls (between test phases). */
  reset: () => void;
};

// Host drawing/IO globals the chain UI may call; recorded as draw calls.
const HOST_OPS = [
  "clear_screen",
  "print",
  "set_pixel",
  "draw_rect",
  "fill_rect",
  "draw_line",
  "fill_circle",
  "draw_image",
  "host_module_set_param"
];

// Names imported from the device shared modules (constants / input_filter /
// menu_layout). Values only need to be plausible + distinct; the menu helpers
// are no-ops so the test isolates the chain UI's own logic (incl. the scope).
function sharedModuleMocks(): Record<string, unknown> {
  const m: Record<string, unknown> = {
    MidiNoteOn: 0x90,
    MidiNoteOff: 0x80,
    MoveMainButton: 3,
    MoveMainKnob: 14,
    decodeDelta: (v: number) => (v < 64 ? v : v - 128),
    drawFooter: () => {},
    drawHeader: () => {},
    drawOverlay: () => {},
    drawMenuList: () => {},
    FOOTER_RULE_Y: 50,
    LIST_TOP_Y: 16,
    hideOverlay: () => {},
    showOverlay: () => {},
    tickOverlay: () => false
  };
  for (let i = 1; i <= 8; i++) {
    m[`MoveKnob${i}`] = 70 + i; // 71..78
    m[`MoveKnob${i}Touch`] = i - 1; // 0..7
  }
  return m;
}

export function loadChainUi(uiChainPath: string): LoadedChainUi {
  let src = readFileSync(uiChainPath, "utf8");
  // Drop the ES imports (device paths that don't resolve here); their bindings
  // are injected into the sandbox instead.
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*["'][^"']*["'];?/g, "");

  const draws: DrawCall[] = [];
  const params = new Map<string, string | null>();

  const sandbox: Record<string, unknown> = {
    ...sharedModuleMocks(),
    text_width: (s: string) => (s ? s.length * 5 : 0),
    host_module_get_param: (key: string) => (params.has(key) ? params.get(key) : null),
    Math,
    console
  };
  for (const op of HOST_OPS) {
    sandbox[op] = (...args: number[]) => {
      draws.push({ op, args });
    };
  }
  sandbox.globalThis = sandbox;

  createContext(sandbox);
  runInContext(src, sandbox, { filename: uiChainPath });

  const ui = sandbox.chain_ui as ChainUi | undefined;
  if (!ui || typeof ui.tick !== "function") {
    throw new Error(`${uiChainPath} did not set a usable globalThis.chain_ui`);
  }

  return {
    ui,
    draws,
    setParam: (key, value) => params.set(key, value),
    reset: () => {
      draws.length = 0;
    }
  };
}

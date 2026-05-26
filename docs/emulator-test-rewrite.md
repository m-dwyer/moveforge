# Emulator test rewrite

## Status

`scripts/test-emulator.ts` is currently a stub. The original Playwright suite
asserted against the vanilla-JS UI that was removed in the React migration
(`web/src/app.ts` and friends). This doc captures what the old suite covered
so a rewrite against the new React UI preserves the same coverage.

## What the old test covered

Source: previous `scripts/test-emulator.ts` (recoverable from git history,
last passing commit on `main` before `web-react-port`).

1. **Module picker populates from the index.** Top-level Module dropdown lists
   "Westfold" and "Dustline" (and only sound generators).
2. **Switching modules updates panel title + params.** Picking Dustline flips
   the panel title to "Dustline" and the param list to Dustline's params
   (`Wave`, `Noise`, `Cutoff`).
3. **Chain exposes 5 slots in the right order.** MIDI FX, Sound, Audio FX 1,
   Audio FX 2, Settings.
4. **Per-slot Audio FX picker loads modules.** Click Audio FX 1, pick "Foo",
   slot name becomes "Foo", params (e.g. `Time`) appear in the controls panel.
   Clearing the picker returns the slot to "Empty".
5. **Per-slot MIDI FX picker loads modules.** Same pattern with "Arpy" on the
   MIDI FX slot; verifies a `Pattern` param shows up.
6. **Settings slot shows the right rows.** Selecting Settings shows
   `Slot Vol`, `MIDI Out` in the controls panel.
7. **Master mode switch.** Clicking the master-mode key (in the legacy UI the
   "Note Session" button) flipped the chain to 4 slots and the status text to
   "Master". The React UI does not yet expose master mode; either add it or
   drop this coverage.
8. **No horizontal overflow at narrow widths.** Resize viewport to 760×1000 and
   assert no `.control` element has `scrollWidth > clientWidth`. Worth keeping
   when responsive design lands.
9. **Audio actually starts on first pad press.** Click a pad, then assert
   `body.dataset.audio === "ready"`. The React app does not currently set
   `body.dataset.audio`; the audio engine has its own readiness signal — add
   either a body data attribute or a test-only DOM hook.

## Mapping legacy selectors to the React UI

| Legacy selector | React equivalent |
|---|---|
| `#moduleSelect` | shadcn Select trigger in `Panel.tsx`. Selection via `<select>`'s `selectOption()` won't work — Radix renders a popover. Either click the trigger and the item by visible text, or add `data-testid="top-module-select"` to the trigger and option items. |
| `.chain-slot` | The row `<div>` in `ChainSlot.tsx`. Add `data-testid="chain-slot"` and a `data-slot-kind` (or `data-slot-index`) for ordering assertions. |
| `[data-chain-picker]` | The per-slot shadcn Select inside `ChainSlot.tsx`. Same Radix interaction issue as the top picker. |
| `#chainInspector` | **Removed.** The inspector card no longer exists; bypass + module pick are inline on the slot row. Drop the assertion. |
| `#controls` | The param container in `Controls.tsx`. Add `data-testid="controls"`. |
| `#panelTitle` | `<h1>` in `Panel.tsx`. Add `data-testid="panel-title"`. |
| `#status` | The "Track N / Slot Type" line in `Panel.tsx`. |
| `#noteSessionKey` | No equivalent yet (master mode UI not ported). |
| `.pad.playable` | `<button>` in `PadGrid.tsx`. Add `data-testid="pad"`. |
| `body.dataset.audio` | Not set. Add this from `audio.ts` (`document.body.dataset.audio = "ready"` after `engine.ready`), or expose a `data-audio` attr on a known element. |

## Concrete pre-work for the rewrite

Before writing the new Playwright test, land these small changes in the React
components so selectors are stable:

1. `data-testid="top-module-select"` on the top picker's trigger in `Panel.tsx`.
2. `data-testid="chain-slot"` + `data-slot-kind="{kind}"` on the row in `ChainSlot.tsx`.
3. `data-testid="slot-picker"` on the per-slot Select trigger.
4. `data-testid="controls"` on the controls container in `Controls.tsx`.
5. `data-testid="panel-title"` on the `<h1>` in `Panel.tsx`.
6. `data-testid="pad"` on each pad button in `PadGrid.tsx`.
7. In `audio.ts`, after `ensureBooted()` succeeds, set `document.body.dataset.audio = "ready"`. Set `"failed"` from `onError`.

## How to drive a shadcn Select from Playwright

Radix Select renders an unstyled trigger and a popover; the value lives in a
hidden `<select>`-like element. The reliable pattern:

```ts
await page.getByTestId("top-module-select").click();
await page.getByRole("option", { name: "Dustline" }).click();
```

or, with explicit option testids:

```ts
await page.getByTestId("top-module-select").click();
await page.getByTestId("module-option-dustline").click();
```

## How to start the server for the test

Use Vite programmatically (Vite is now the dev server, no separate static
server lib):

```ts
import { createServer } from "vite";
const server = await createServer({ server: { port: 0 } });
await server.listen();
const url = `http://localhost:${server.config.server.port}/web/`;
// ...
await server.close();
```

## Scope decision for "master mode"

The legacy test asserted master-mode behaviour (the 4-slot master FX chain).
The React UI does not surface master mode yet. The rewrite should either:

- Drop the master-mode assertions and document the gap, or
- Wait until master mode is ported (no scheduled chunk).

Recommend dropping for now; track separately if/when master mode is restored.

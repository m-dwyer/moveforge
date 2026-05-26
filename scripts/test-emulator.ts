#!/usr/bin/env node
import { chromium, type Locator, type Page } from "playwright";
import { selectedModuleId } from "./lib/modules.ts";
import { startStaticServer } from "./lib/static-server.ts";

const port = Number(process.env.PORT ?? 0);
const moduleId = selectedModuleId();
const server = await startStaticServer({ port });

try {
  await main();
} finally {
  await server.close();
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${server.origin}/`);
    await page.waitForSelector(".chain-slot");

    await expectText(page.locator("#moduleSelect"), "Westfold");
    await expectText(page.locator("#moduleSelect"), "Dustline");
    await expectText(page.locator("#panelTitle"), "Westfold");

    if (moduleId === "dustline") {
      await page.locator("#moduleSelect").selectOption("dustline");
      await expectText(page.locator("#panelTitle"), "Dustline");
      await expectText(page.locator("#controls"), "Wave");
      await expectText(page.locator("#controls"), "Noise");
      await expectText(page.locator("#controls"), "Cutoff");
    } else {
      await expectText(page.locator("#controls"), "Ratio");
      await page.locator("#moduleSelect").selectOption("dustline");
      await page.waitForSelector(".chain-slot");
      await expectText(page.locator("#panelTitle"), "Dustline");
      await expectText(page.locator("#controls"), "Wave");
      await expectText(page.locator("#controls"), "Noise");
      await expectText(page.locator("#controls"), "Cutoff");
    }

    const slots = page.locator(".chain-slot");
    if (await slots.count() !== 5) throw new Error("slot chain should expose 5 positions");
    await expectText(slots.nth(0), "MIDI FX");
    await expectText(slots.nth(2), "Audio FX 1");
    await expectText(slots.nth(3), "Audio FX 2");
    await expectText(slots.nth(4), "Settings");

    await slots.nth(2).click();
    await expectText(page.locator("#chainInspector"), "Audio FX 1");
    await expectText(page.locator("#chainInspector"), "Module");
    await expectText(page.locator("#controls"), "Drive");
    await page.locator("[data-chain-toggle]").click();
    await expectText(slots.nth(2), "enabled");

    // MIDI FX picker: select velo_scale and confirm the slot reflects it.
    await slots.nth(0).click();
    await expectText(page.locator("#chainInspector"), "MIDI FX");
    const midiPicker = page.locator("[data-chain-picker]");
    await midiPicker.selectOption("velo_scale");
    await expectText(slots.nth(0), "Velo Scale");
    // Clearing the picker should restore "Empty".
    await midiPicker.selectOption("");
    await expectText(slots.nth(0), "Empty");
    // Re-select so the final pad click exercises midi_fx → sound routing.
    await midiPicker.selectOption("velo_scale");
    await expectText(slots.nth(0), "Velo Scale");

    await slots.nth(4).click();
    await expectText(page.locator("#chainInspector"), "Slot Settings");
    await expectText(page.locator("#controls"), "Slot Vol");
    await expectText(page.locator("#controls"), "MIDI Out");

    await page.locator("#noteSessionKey").click();
    if (await slots.count() !== 4) throw new Error("master chain should expose 4 FX positions");
    await expectText(page.locator("#status"), "Master");

    await page.setViewportSize({ width: 760, height: 1000 });
    await page.locator("#noteSessionKey").click();
    const overflowing = await page.locator(".control").evaluateAll((nodes) =>
      nodes.some((node) => node.scrollWidth > node.clientWidth + 1)
    );
    if (overflowing) throw new Error("control cards should not horizontally overflow at narrow width");

    await page.locator(".pad.playable").first().click();
    await expectBodyAudioState(page, "ready", 6000);
  } finally {
    await browser.close();
  }
}

async function expectBodyAudioState(page: Page, state: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.locator("body").evaluate((body, expected) => body.dataset.audio === expected, state)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`expected body data-audio: ${state}`);
}

async function expectText(locator: Locator, text: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await locator.textContent())?.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`expected text: ${text}`);
}

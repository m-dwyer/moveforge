import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.PORT || 8876);
const moduleId = process.env.MODULE_ID || "westfold";
const moduleQuery = moduleId === "westfold" ? "" : `?module=${encodeURIComponent(moduleId)}`;
const server = spawn("python3", ["-m", "http.server", String(port)], {
  stdio: ["ignore", "pipe", "pipe"]
});

async function waitForServer() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/web/${moduleQuery}`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`server did not start on port ${port}`);
}

async function main() {
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  await waitForServer();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/web/${moduleQuery}`);
  await page.waitForSelector(".chain-slot");
  await expectText(page.locator("#moduleSelect"), moduleId === "dustline" ? "Dustline" : "Westfold");
  await expectText(page.locator("#moduleSelect"), "Dustline");
  await expectText(page.locator("#panelTitle"), moduleId === "dustline" ? "Dustline" : "Westfold");

  const slots = page.locator(".chain-slot");
  if (await slots.count() !== 5) throw new Error("slot chain should expose 5 positions");
  await expectText(slots.nth(0), "MIDI FX");
  await expectText(slots.nth(2), "Audio FX 1");
  await expectText(slots.nth(3), "Audio FX 2");
  await expectText(slots.nth(4), "Settings");

  await slots.nth(2).click();
  await expectText(page.locator("#chainInspector"), "Drive Tone");
  await expectText(page.locator("#controls"), "Drive");
  await page.locator("[data-chain-toggle]").click();
  await expectText(slots.nth(2), "enabled");

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

  await browser.close();
}

async function expectText(locator, text) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if ((await locator.textContent())?.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`expected text: ${text}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    server.kill();
    await once(server, "exit").catch(() => {});
  });

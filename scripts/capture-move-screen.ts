#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "node:process";
import { chromium } from "playwright";

const url = env.MOVE_SCREEN_URL || "http://move.local:7681/";
const out = env.MOVE_SCREEN_OUT || "renders/move-screen.png";

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle", timeout: 10_000 });
  await page.screenshot({ path: out, fullPage: true });
  console.log(`captured ${url} -> ${out}`);
} finally {
  await browser.close();
}

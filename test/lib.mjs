// Shared rig for the TabRest regression tests: a local site, a real Chrome with
// the unpacked extension, and a handle on its service worker.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export const EXT = path.resolve(import.meta.dirname, "..");

// puppeteer-core is not vendored here; point PUPPETEER_DIR at a checkout that
// has it, or install it in this folder.
function loadPuppeteer() {
  const candidates = [
    process.env.PUPPETEER_DIR && path.join(process.env.PUPPETEER_DIR, "package.json"),
    path.join(import.meta.dirname, "package.json"),
    path.resolve(import.meta.dirname, "../../hookrate/package.json")
  ].filter(Boolean);
  for (const c of candidates) {
    try { return createRequire(c)("puppeteer-core"); } catch {}
  }
  throw new Error("puppeteer-core not found. npm i puppeteer-core in test/, or set PUPPETEER_DIR.");
}

// Note: an installed stable Google Chrome will NOT work here. Recent versions
// ignore --load-extension outright, so the extension never loads and every test
// times out looking for its service worker. Use Chrome for Testing:
//   npx @puppeteer/browsers install chrome@stable
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const guesses = [
    path.resolve(import.meta.dirname, "../../hookrate/chrome/win64-152.0.7977.75/chrome-win64/chrome.exe"),
    // deliberately not falling back to an installed Google Chrome: see above
  ];
  for (const g of guesses) if (fs.existsSync(g)) return g;
  throw new Error("Chrome not found. Set CHROME_PATH.");
}

// A site whose pages finish after `delayMs`, counting every request it serves so
// a test can tell whether tabs kept downloading after Suspend All.
export async function startSite({ delayMs = 1500, origins = 1 } = {}) {
  const hits = [];
  const servers = [], ports = [];
  for (let i = 0; i < origins; i++) {
    const s = http.createServer((req, res) => {
      hits.push(Date.now());
      res.writeHead(200, { "Content-Type": "text/html" });
      res.write(`<title>page</title><h1>${req.url}</h1><input id="i" type="text">`);
      setTimeout(() => { try { res.end("<p>done"); } catch {} }, delayMs);
    });
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    servers.push(s); ports.push(s.address().port);
  }
  return {
    ports, hits,
    url: (i = 0, q = "") => `http://127.0.0.1:${ports[i % ports.length]}/p${q}`,
    hitsSince: (t) => hits.filter((h) => h > t),
    close: () => servers.forEach((s) => { try { s.close(); } catch {} })
  };
}

export async function launch(opts = {}) {
  const puppeteer = loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: false,                     // MV3 extensions need a real browser
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--no-first-run",
      // CI runners have no usable Chrome sandbox and a small /dev/shm.
      ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [])
    ],
    ...opts
  });
  const target = await browser.waitForTarget((t) => t.type() === "service_worker", { timeout: 20000 });
  return { browser, worker: await target.worker(), extId: target.url().split("/")[2] };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

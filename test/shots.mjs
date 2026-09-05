// Regenerates the store screenshots from the real extension, so they can never
// drift from what the product actually looks like.
//   node test/shots.mjs
import path from "node:path";
import { startSite, launch, sleep, EXT } from "./lib.mjs";

const OUT = path.join(EXT, "store");
const W = 1280, H = 800;

const site = await startSite({ delayMs: 200 });
const { browser, extId } = await launch();

try {
  // Give the popup something real to show. Real sites, because a store listing
  // full of 127.0.0.1 entries looks like what it is.
  const SEED = [
    "https://en.wikipedia.org/wiki/Memory_management",
    "https://developer.mozilla.org/en-US/docs/Web/API",
    "https://news.ycombinator.com/",
    "https://github.com/explore",
    "https://stackoverflow.com/questions",
    "https://arxiv.org/list/cs.SE/recent",
    "https://www.bbc.com/news"
  ];
  const worker = (await (await browser.waitForTarget((t) => t.type() === "service_worker")).worker());
  await worker.evaluate(async (urls) => {
    for (const u of urls) await chrome.tabs.create({ url: u, active: false });
    await new Promise((r) => setTimeout(r, 6000));   // let titles and favicons arrive
    await suspendAll();
  }, SEED);
  await sleep(2000);

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

  const shot = async (url, file) => {
    await page.goto(url);
    await sleep(1400);                        // let live counts settle
    await page.screenshot({ path: path.join(OUT, file) });
    console.log("wrote", file);
  };

  const frame = (params) =>
    `chrome-extension://${extId}/test/shot-frame.html?${new URLSearchParams(params)}`;

  await shot(frame({
    h: "Put idle tabs to rest",
    p: "Suspended tabs stop using CPU and memory. Nothing is closed - click a tab and it comes right back."
  }), "screenshot-1-1280x800.png");

  // The options page is a full-width page; showing it inside the narrow popup
  // frame would misrepresent it.
  await shot(`chrome-extension://${extId}/options.html`, "screenshot-2-1280x800.png");

  // The parked page, shown as a user actually sees it.
  const sample = new URLSearchParams({
    u: "https://en.wikipedia.org/wiki/Memory_management",
    t: "Memory management - Wikipedia",
    f: ""
  });
  await shot(`chrome-extension://${extId}/suspended.html#${sample}`, "screenshot-3-1280x800.png");
} finally {
  await browser.close();
  site.close();
  process.exit(0);
}

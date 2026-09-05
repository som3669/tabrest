// Regression: auto-suspend must survive the service worker being evicted.
//
// Idle timestamps used to live only in a module-level object in the worker. MV3
// evicts the worker after ~30s idle, so the alarm woke a fresh one with an empty
// map, every tab looked freshly used, and auto-suspend never fired at all.
//
// Waiting around to catch a real eviction does not work as a test: polling the
// browser often enough to observe it is itself enough to keep the worker alive,
// so the check never trips. Instead this simulates exactly what eviction does —
// wipe the worker's in-memory state — and then runs a scan. A worker that has
// forgotten everything must still suspend idle tabs, by reloading the
// timestamps it persisted and consulting tab.lastAccessed.
//
// Against the old code this fails: with the map empty it treated every tab as
// just-used and suspended nothing.
import assert from "node:assert/strict";
import { startSite, launch, sleep } from "./lib.mjs";

const IDLE_WAIT_MS = 70000;   // must exceed the 1 minute threshold below

export default async function run() {
  const site = await startSite({ delayMs: 200 });
  const { browser, worker, extId } = await launch();
  try {
    const page = (await browser.pages())[0];
    await page.goto(`chrome-extension://${extId}/test/probe.html`);

    await worker.evaluate(() => chrome.storage.sync.set({ enabled: true, idleMinutes: 1, autoClose: false }));
    await worker.evaluate(async (base, n) => {
      for (let i = 0; i < n; i++) await chrome.tabs.create({ url: base + i, active: false });
    }, site.url(0, "?i="), 12);
    await sleep(3000);

    // The timestamps must be written somewhere that outlives the worker.
    const persisted = await page.evaluate(async () => {
      const { seenMap = {} } = await chrome.storage.session.get({ seenMap: {} });
      return Object.keys(seenMap).length;
    });
    assert.ok(persisted > 0, "idle timestamps must be persisted outside the worker");

    // Let the tabs go idle past the 1 minute threshold.
    await sleep(IDLE_WAIT_MS);

    const result = await worker.evaluate(async () => {
      // Exactly what an eviction costs us: everything held in memory.
      lastActive = {};
      seenLoaded = false;

      await scan();
      await new Promise((r) => setTimeout(r, 500));
      const park = chrome.runtime.getURL("suspended.html");
      const all = await chrome.tabs.query({});
      return {
        suspended: all.filter((t) => t.discarded || (t.url || "").startsWith(park)).length,
        recovered: Object.keys(lastActive).length
      };
    });

    assert.ok(result.suspended > 0,
      "a restarted worker suspended nothing - it has forgotten when tabs were last used");
    assert.ok(result.recovered > 0, "the worker should have reloaded its persisted timestamps");
    return `${persisted} timestamps persisted; after a simulated eviction, scan suspended ${result.suspended} tabs`;
  } finally {
    await browser.close();
    site.close();
  }
}

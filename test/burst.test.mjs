// Regression: opening a burst of tabs and hitting Suspend All must stop every
// one of them at once, keep every address, and leave nothing downloading.
//
// Chrome only loads ~6 tabs per host at a time; the rest sit with an empty
// tab.url and their address in tab.pendingUrl. Those used to be skipped
// entirely (read as chrome:// pages), so most of a burst kept on loading.
import assert from "node:assert/strict";
import { startSite, launch, sleep } from "./lib.mjs";

const N = 48;

export default async function run() {
  const site = await startSite({ delayMs: 1500 });
  const { browser, worker } = await launch();
  try {
    const want = await worker.evaluate(async (base, n) => {
      const m = [];
      for (let i = 0; i < n; i++) {
        m.push([(await chrome.tabs.create({ url: base + i, active: false })).id, base + i]);
      }
      await new Promise((r) => setTimeout(r, 2000));
      return m;
    }, site.url(0, "?i="), N);

    const clickAt = Date.now();
    await worker.evaluate(() => suspendAll());

    // Wait for the network to settle, then see how long it kept going.
    let last = Date.now();
    while (Date.now() - last < 3000 && Date.now() - clickAt < 45000) {
      await sleep(250);
      const newest = site.hits.length ? site.hits[site.hits.length - 1] : 0;
      if (newest > last) last = newest;
    }
    const after = site.hitsSince(clickAt);
    const quietSec = after.length ? (Math.max(...after) - clickAt) / 1000 : 0;

    const state = await worker.evaluate(async (want) => {
      const park = chrome.runtime.getURL("suspended.html");
      const all = await chrome.tabs.query({});
      const orig = (t) => {
        try { return new URLSearchParams(new URL(t.url).hash.slice(1)).get("u") || ""; }
        catch { return ""; }
      };
      let kept = 0;
      for (const [id, u] of want) {
        const t = all.find((x) => x.id === id);
        if (!t) continue;
        const addr = (t.url || "").startsWith(park) ? orig(t) : (t.url || t.pendingUrl || "");
        if (addr === u) kept++;
      }
      return {
        suspended: all.filter((t) => t.discarded || (t.url || "").startsWith(park)).length,
        stillLoading: all.filter((t) => t.status === "loading").length,
        addressesKept: kept
      };
    }, want);

    assert.equal(state.suspended, N, `expected all ${N} tabs suspended, got ${state.suspended}`);
    assert.equal(state.stillLoading, 0, "no tab may still be loading");
    assert.equal(state.addressesKept, N, "every tab must keep its address");
    // A handful of requests always land just after the click: connections that
    // were already dispatched when the button was pressed. What matters is that
    // the flow stops within a moment instead of grinding on for ~20s, and that
    // nowhere near the whole batch gets through.
    assert.ok(quietSec < 3, `tabs were still downloading ${quietSec}s after the click`);
    assert.ok(after.length < N / 2,
      `most of the batch should never have started, but ${after.length} of ${N} requests landed after the click`);
    return `${N}/${N} suspended, ${after.length} late requests, quiet at t+${quietSec.toFixed(1)}s`;
  } finally {
    await browser.close();
    site.close();
  }
}

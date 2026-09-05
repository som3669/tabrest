// Regression: the options page must actually write what it shows, and the
// service worker must act on it. Settings that silently fail to apply are the
// kind of thing nobody notices until a review says the feature does nothing.
//
// Covers: the stop-mid-load toggle (both positions, checked against real tab
// behaviour), per-site idle rules, and the whitelist round-tripping through the
// page rather than through storage directly.
import assert from "node:assert/strict";
import { startSite, launch, sleep } from "./lib.mjs";

export default async function run() {
  const site = await startSite({ delayMs: 1500 });
  const { browser, worker, extId } = await launch();
  try {
    const page = (await browser.pages())[0];
    await page.goto(`chrome-extension://${extId}/options.html`);
    await sleep(500);

    // --- the page writes what it shows ---
    const defaults = await page.evaluate(() => ({
      stopMidLoad: document.getElementById("stopMidLoad").checked,
      skipPinned: document.getElementById("skipPinned").checked
    }));
    assert.equal(defaults.stopMidLoad, true, "stop-mid-load should default to on");
    assert.equal(defaults.skipPinned, true, "skip pinned should default to on");

    await page.$eval("#stopMidLoad", (el) => el.click());
    await sleep(400);
    const stored = await page.evaluate(() => chrome.storage.sync.get({ stopMidLoad: true }));
    assert.equal(stored.stopMidLoad, false, "unchecking the toggle must persist");

    // --- with it off, queued tabs are left alone rather than parked ---
    const off = await worker.evaluate(async (base, n) => {
      for (let i = 0; i < n; i++) await chrome.tabs.create({ url: base + i, active: false });
      await new Promise((r) => setTimeout(r, 2000));
      await suspendAll();
      await new Promise((r) => setTimeout(r, 800));
      const park = chrome.runtime.getURL("suspended.html");
      const all = await chrome.tabs.query({});
      const { pendingSuspend = [] } = await chrome.storage.session.get({ pendingSuspend: [] });
      return { parked: all.filter((t) => (t.url || "").startsWith(park)).length,
               queuedForLater: pendingSuspend.length };
    }, site.url(0, "?off="), 24);
    assert.equal(off.parked, 0, "with the toggle off no tab may be parked");
    assert.ok(off.queuedForLater > 0, "tabs that could not be discarded should be queued instead");

    // --- back on, the same burst parks ---
    await page.bringToFront();
    await page.$eval("#stopMidLoad", (el) => el.click());
    await sleep(400);
    const on = await worker.evaluate(async (base, n) => {
      for (const t of await chrome.tabs.query({})) {
        if ((t.url || "").startsWith("http://127")) { try { await chrome.tabs.remove(t.id); } catch {} }
      }
      await chrome.storage.session.set({ pendingSuspend: [] });
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 0; i < n; i++) await chrome.tabs.create({ url: base + i, active: false });
      await new Promise((r) => setTimeout(r, 2000));
      await suspendAll();
      await new Promise((r) => setTimeout(r, 800));
      const park = chrome.runtime.getURL("suspended.html");
      const all = await chrome.tabs.query({});
      return { parked: all.filter((t) => (t.url || "").startsWith(park)).length };
    }, site.url(0, "?on="), 24);
    assert.ok(on.parked > 0, "with the toggle on, queued tabs should be parked");

    // --- per-site rules reach the worker's threshold logic ---
    const rules = await worker.evaluate(async () => {
      await chrome.storage.sync.set({ idleMinutes: 30, rules: [{ host: "127.0.0.1", minutes: 3 }] });
      const s = await getSettings();
      return { forRuleHost: thresholdFor("127.0.0.1", s), forOtherHost: thresholdFor("example.com", s) };
    });
    assert.equal(rules.forRuleHost, 3, "a per-site rule must override the default threshold");
    assert.equal(rules.forOtherHost, 30, "other hosts must keep the default threshold");

    // --- whitelist added through the page is honoured by the worker ---
    await page.bringToFront();
    await page.evaluate(() => chrome.storage.sync.set({ whitelist: [] }));
    await page.reload();
    await sleep(500);
    await page.type("#wlInput", "127.0.0.1");
    await page.click("#wlAdd");
    await sleep(500);
    const wl = await worker.evaluate(async (base) => {
      for (const t of await chrome.tabs.query({})) {
        if ((t.url || "").startsWith("http://127")) { try { await chrome.tabs.remove(t.id); } catch {} }
      }
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 0; i < 5; i++) await chrome.tabs.create({ url: base + i, active: false });
      await new Promise((r) => setTimeout(r, 2500));
      return await suspendAll();
    }, site.url(0, "?wl="));
    assert.equal(wl, 0, "a site whitelisted from the options page must not be suspended");

    return "toggle persists and changes behaviour both ways; rules and whitelist reach the worker";
  } finally {
    await browser.close();
    site.close();
  }
}

// Regression: the things that must NEVER be suspended stay untouched, and a
// suspended tab comes back. Every guard is checked alongside a control tab that
// does get suspended, so "nothing happened at all" cannot pass as a green run.
import assert from "node:assert/strict";
import { startSite, launch, sleep } from "./lib.mjs";

export default async function run() {
  const site = await startSite({ delayMs: 200 });
  const { browser, worker } = await launch();
  try {
    // Form-guard: typing into a page protects it, an untouched twin does not.
    const dirty = await browser.newPage();
    await dirty.goto(site.url(0, "?p=dirty"));
    await dirty.click("#i");
    await dirty.type("#i", "unsaved work");
    const clean = await browser.newPage();
    await clean.goto(site.url(0, "?p=clean"));
    const spare = await browser.newPage();          // takes focus off both
    await spare.goto(site.url(0, "?p=spare"));
    await sleep(1200);

    const form = await worker.evaluate(async () => {
      const { dirtyTabs = [] } = await chrome.storage.session.get({ dirtyTabs: [] });
      await suspendAll();
      await new Promise((r) => setTimeout(r, 1000));
      const park = chrome.runtime.getURL("suspended.html");
      const all = await chrome.tabs.query({});
      const isOff = (mark) => {
        const t = all.find((x) => (x.url || "").includes(mark));
        return t ? (t.discarded || (t.url || "").startsWith(park)) : "missing";
      };
      return { marked: dirtyTabs.length, dirty: isOff("p=dirty"), clean: isOff("p=clean") };
    });
    assert.equal(form.marked, 1, "the typed-in tab should be flagged dirty");
    assert.equal(form.dirty, false, "a tab with unsaved input must not be suspended");
    assert.equal(form.clean, true, "the control tab should have been suspended");

    // Whitelist, active tab, pinned tab, and restore.
    const rest = await worker.evaluate(async (base) => {
      const nap = (ms) => new Promise((r) => setTimeout(r, ms));
      const clear = async () => {
        for (const t of await chrome.tabs.query({})) {
          if ((t.url || "").startsWith("http://127")) { try { await chrome.tabs.remove(t.id); } catch {} }
        }
        await nap(400);
      };
      await clear();

      await chrome.storage.sync.set({ whitelist: ["127.0.0.1"] });
      for (let i = 0; i < 6; i++) await chrome.tabs.create({ url: base + i, active: false });
      await nap(2500);
      const whitelisted = await suspendAll();
      await chrome.storage.sync.set({ whitelist: [] });
      await clear();

      const act = await chrome.tabs.create({ url: base + "act", active: true });
      const pin = await chrome.tabs.create({ url: base + "pin", active: false });
      await chrome.tabs.update(pin.id, { pinned: true });
      const norm = await chrome.tabs.create({ url: base + "norm", active: false });
      await nap(2500);
      await suspendAll();
      await nap(800);

      const park = chrome.runtime.getURL("suspended.html");
      const off = async (id) => {
        const t = await chrome.tabs.get(id);
        return t.discarded || (t.url || "").startsWith(park);
      };
      const control = await off(norm.id);
      await restoreTab(norm.id);
      await nap(2500);
      const back = await chrome.tabs.get(norm.id);
      return {
        whitelisted,
        active: await off(act.id),
        pinned: await off(pin.id),
        control,
        restored: !back.discarded && !(back.url || "").startsWith(park)
      };
    }, site.url(0, "?p="));

    assert.equal(rest.whitelisted, 0, "a whitelisted site must not be suspended");
    assert.equal(rest.active, false, "the focused tab must never be suspended");
    assert.equal(rest.pinned, false, "pinned tabs must not be suspended");
    assert.equal(rest.control, true, "the control tab should have been suspended");
    assert.equal(rest.restored, true, "a suspended tab must restore");
    return "form-guard, whitelist, active and pinned all hold; restore works";
  } finally {
    await browser.close();
    site.close();
  }
}

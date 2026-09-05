// TabRest service worker: scans tabs on an alarm, discards idle ones.

const DEFAULTS = {
  enabled: true,
  idleMinutes: 30,      // default idle threshold (minutes) before discard
  skipAudible: true,    // never discard tabs playing sound
  skipPinned: true,     // never discard pinned tabs
  whitelist: [],        // array of hostnames never discarded
  rules: [],            // per-site overrides: [{ host, minutes }]
  autoClose: false,     // OFF by default — auto-close (not just suspend) idle tabs
  autoCloseMinutes: 120,// idle time before an unused tab is closed
  stopMidLoad: true     // park tabs that are still queued so they stop downloading at once
};

// Rough RAM estimate per suspended tab (bytes). Chrome frees ~50-150MB per tab.
const EST_BYTES_PER_TAB = 100 * 1024 * 1024;

// tabId -> last active/interaction timestamp (ms).
//
// This map is only a cache. MV3 evicts the worker after ~30s idle and the alarm
// then wakes a *fresh* worker with an empty map, which made every tab look as if
// it had just been used — the idle threshold was never crossed and auto-suspend
// never fired at all. It is now mirrored into storage.session (survives worker
// eviction) and cross-checked against tab.lastAccessed, which Chrome maintains.
let lastActive = {};
let seenLoaded = false;

async function loadSeen() {
  if (seenLoaded) return lastActive;
  const { seenMap = {} } = await chrome.storage.session.get({ seenMap: {} });
  // Anything this worker touched already is newer than what was persisted.
  lastActive = { ...seenMap, ...lastActive };
  seenLoaded = true;
  return lastActive;
}

async function saveSeen() {
  try { await chrome.storage.session.set({ seenMap: lastActive }); } catch {}
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// A tab whose navigation has not committed yet reports an empty url and keeps
// its address in pendingUrl. Chrome queues most of a large batch of new tabs in
// exactly that state, and treating them as urlless made Suspend All skip them
// as if they were chrome:// pages — so a burst of tabs just kept on loading.
function urlOf(tab) {
  return tab.url || tab.pendingUrl || "";
}

async function touch(tabId) {
  await loadSeen();
  lastActive[tabId] = Date.now();
  await saveSeen();
}

// When was this tab last used? Take the newest of our own record and Chrome's,
// so a restarted worker still has a real answer instead of assuming "just now".
function seenTime(tab, now) {
  const t = Math.max(lastActive[tab.id] || 0, tab.lastAccessed || 0);
  return t || now;
}

// Idle threshold (minutes) for a host: per-site rule wins, else default.
function thresholdFor(host, s) {
  const rule = (s.rules || []).find((r) => r.host === host);
  return rule ? rule.minutes : s.idleMinutes;
}

// --- Form-guard: tabs with unsaved input (persisted so it survives SW sleep) ---
async function getDirty() {
  const { dirtyTabs = [] } = await chrome.storage.session.get({ dirtyTabs: [] });
  return new Set(dirtyTabs);
}
async function markDirty(tabId, dirty) {
  const set = await getDirty();
  if (dirty) set.add(tabId); else set.delete(tabId);
  await chrome.storage.session.set({ dirtyTabs: [...set] });
}

// --- Retry queue: tabs Chrome refused to discard because they were loading ---
async function getPending() {
  const { pendingSuspend = [] } = await chrome.storage.session.get({ pendingSuspend: [] });
  return new Set(pendingSuspend);
}
async function setPending(set) {
  await chrome.storage.session.set({ pendingSuspend: [...set] });
}
async function markPending(tabId, on) {
  const set = await getPending();
  if (on) set.add(tabId); else set.delete(tabId);
  await setPending(set);
}

// --- Undo: remember the last batch of tabs we suspended ---
async function rememberBatch(ids) {
  await chrome.storage.session.set({ lastBatch: ids });
}

// --- Whitelist helper ---
async function addToWhitelist(host) {
  if (!host) return;
  const { whitelist = [] } = await chrome.storage.sync.get({ whitelist: [] });
  if (!whitelist.includes(host)) {
    whitelist.push(host);
    await chrome.storage.sync.set({ whitelist });
  }
}

// Lifetime stats live in storage.local (not synced).
async function bumpStats(n) {
  if (!n) return;
  const cur = await chrome.storage.local.get({ lifetimeCount: 0 });
  await chrome.storage.local.set({ lifetimeCount: cur.lifetimeCount + n });
}

// Discard one tab. Returns true only if it really is discarded afterwards —
// Chrome resolves discard() without complaint on tabs it decides to skip.
async function discardTab(tabId) {
  try {
    await chrome.tabs.discard(tabId);
    const t = await chrome.tabs.get(tabId);
    return !!t.discarded;
  } catch { return false; }
}

// A tab whose navigation has not committed yet cannot be discarded: Chrome
// throws the pending address away and leaves the user with a blank tab. Chrome
// queues most of a large batch of new tabs in exactly that state.
function isUncommitted(tab) {
  return !tab.url && !!tab.pendingUrl;
}

// --- Parking: the placeholder page we send un-discardable tabs to ---
//
// Navigating a tab to an extension page commits immediately and cancels the
// pending network load, which discard() cannot do. The original address rides
// along in the hash so the tab can always be sent back.
const PARK_PAGE = chrome.runtime.getURL("suspended.html");

function isParked(tab) {
  return !!tab.url && tab.url.startsWith(PARK_PAGE);
}

// The address a parked tab came from.
function parkedOrigin(tab) {
  try { return new URLSearchParams(new URL(tab.url).hash.slice(1)).get("u") || ""; }
  catch { return ""; }
}

async function parkTab(tab) {
  const orig = urlOf(tab);
  if (!orig) return false;
  const q = new URLSearchParams({ u: orig, t: tab.title || "", f: tab.favIconUrl || "" });
  try {
    await chrome.tabs.update(tab.id, { url: `${PARK_PAGE}#${q}` });
    return true;
  } catch { return false; }
}

// Send a parked tab back to where it came from.
async function unparkTab(tab) {
  const orig = parkedOrigin(tab);
  if (!orig) return false;
  try { await chrome.tabs.update(tab.id, { url: orig }); return true; }
  catch { return false; }
}

// Bring a tab back, whichever way it was suspended.
async function restoreTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isParked(tab)) return await unparkTab(tab);
    await chrome.tabs.reload(tabId);
    return true;
  } catch { return false; }
}

// Every tab the user would consider suspended: discarded or parked.
async function suspendedTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => t.discarded || isParked(t));
}

// Suspend a tab: park it if it cannot be discarded, otherwise discard it.
// With stopMidLoad off, a tab that cannot be discarded is left to finish
// loading and picked up by onUpdated instead — slower, but such a tab never
// shows a TabRest address.
async function suspendTab(tab, s) {
  if (isUncommitted(tab)) {
    if (s && s.stopMidLoad === false) {
      await markPending(tab.id, true);
      return false;
    }
    return await parkTab(tab);
  }
  const ok = await discardTab(tab.id);
  await markPending(tab.id, !ok);
  return ok;
}

// Badge = count of currently discarded tabs.
async function updateBadge() {
  const n = (await suspendedTabs()).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2b6cff" });
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
}

// Loading a batch of tabs fires hundreds of onUpdated events; coalesce them so
// the worker is not running a tabs.query per event.
let badgeTimer = null;
function queueBadge() {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => { badgeTimer = null; updateBadge(); }, 400);
}

// Seed timestamps for existing tabs on startup/install.
async function seed() {
  await loadSeen();
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  for (const t of tabs) lastActive[t.id] = t.lastAccessed || lastActive[t.id] || now;
  await saveSeen();
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "suspend-this", title: "Suspend this tab", contexts: ["page", "action"] });
    chrome.contextMenus.create({ id: "never-site", title: "Never suspend this site", contexts: ["page", "action"] });
  });
}

async function init() {
  await seed();
  updateBadge();
  createMenus();
  chrome.alarms.create("scan", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

// Track interaction so active/recent tabs are safe.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await touch(tabId);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isParked(tab)) await unparkTab(tab);
  } catch {}
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Discarding a tab fires onUpdated too — don't treat that as user activity,
  // or the idle timer would reset and auto-close could never trigger.
  if (changeInfo.discarded === true) { queueBadge(); return; }

  // Only navigation counts as activity. Title/favicon/audible churn from a
  // background tab used to reset its idle timer and keep it alive forever.
  if (changeInfo.status === "loading" || changeInfo.url) {
    await touch(tabId);
    markDirty(tabId, false); // navigating clears any unsaved-form flag
  }

  // A tab we could not suspend earlier has landed — suspend it now, but re-check
  // the protections first: the user may have focused or whitelisted it since.
  if (changeInfo.status === "complete") {
    const pending = await getPending();
    if (pending.has(tabId)) {
      const s = await getSettings();
      const dirty = await getDirty();
      let tab = null;
      try { tab = await chrome.tabs.get(tabId); } catch {}
      if (tab && !shouldSkip(tab, s, dirty) && await discardTab(tabId)) await bumpStats(1);
      await markPending(tabId, false);
    }
  }
  queueBadge();
});
chrome.tabs.onCreated.addListener((tab) => touch(tab.id));
chrome.tabs.onRemoved.addListener((tabId) => {
  delete lastActive[tabId];
  saveSeen();
  markDirty(tabId, false);
  markPending(tabId, false);
  queueBadge();
});

// Protections shared by suspend and close (does NOT check discarded state).
function isProtected(tab, s, dirty) {
  if (tab.active) return true;                 // never touch focused tab
  if (s.skipPinned && tab.pinned) return true;
  if (s.skipAudible && tab.audible) return true;
  if (dirty && dirty.has(tab.id)) return true; // unsaved form input
  const host = hostOf(urlOf(tab));
  if (!host) return true;                       // chrome:// pages etc.
  if (s.whitelist.includes(host)) return true;
  return false;
}

// Skip rule for SUSPEND: protections + already-suspended tabs.
function shouldSkip(tab, s, dirty) {
  if (isProtected(tab, s, dirty)) return true;
  if (tab.discarded) return true;              // already suspended
  if (isParked(tab)) return true;              // sitting on the placeholder page
  return false;
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
    const cur = await chrome.storage.local.get({ closedCount: 0 });
    await chrome.storage.local.set({ closedCount: cur.closedCount + 1 });
    return true;
  } catch { return false; }
}

async function scan() {
  const s = await getSettings();
  if (!s.enabled) return;
  await loadSeen();
  const dirty = await getDirty();
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  const done = [];

  // Keep the focused tab's clock running: tab.lastAccessed is the moment a tab
  // was activated, so without this a tab you read for an hour would look an hour
  // idle the instant you switched away from it.
  for (const tab of tabs) if (tab.active) lastActive[tab.id] = now;
  await saveSeen();

  for (const tab of tabs) {
    const seen = seenTime(tab, now);

    // Auto-close pass (opt-in). Applies to idle tabs incl. already-suspended ones,
    // but never to protected tabs (active/pinned/audible/whitelist/unsaved forms).
    if (s.autoClose && !isProtected(tab, s, dirty)) {
      const closeCutoff = now - s.autoCloseMinutes * 60 * 1000;
      if (seen <= closeCutoff) { await closeTab(tab.id); continue; }
    }

    // Suspend pass.
    if (shouldSkip(tab, s, dirty)) continue;
    const minutes = thresholdFor(hostOf(urlOf(tab)), s);
    const cutoff = now - minutes * 60 * 1000;
    if (seen <= cutoff && await suspendTab(tab, s)) done.push(tab.id);
  }
  if (done.length) { await bumpStats(done.length); await rememberBatch(done); }
  updateBadge();
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === "scan") scan(); });

// Suspend all eligible background tabs. Returns count.
async function suspendAll() {
  const s = await getSettings();
  const dirty = await getDirty();
  const tabs = await chrome.tabs.query({ active: false });
  const cands = tabs.filter((t) => !shouldSkip(t, s, dirty));

  // Chrome queues most of a large batch of new tabs with their navigation still
  // uncommitted, and those cannot be discarded. Park them instead — that stops
  // their download at once, which is the whole point of pressing the button.
  const queued = cands.filter(isUncommitted);
  const ready = cands.filter((t) => !isUncommitted(t));

  const parked = s.stopMidLoad === false
    ? queued.map((t) => [t.id, false])            // leave them loading; onUpdated will catch them
    : await Promise.all(queued.map(async (t) => [t.id, await parkTab(t)]));
  const results = await Promise.all(ready.map(async (t) => [t.id, await discardTab(t.id)]));
  const all = [...parked, ...results];
  const done = all.filter(([, ok]) => ok).map(([id]) => id);
  const failed = results.filter(([, ok]) => !ok).map(([id]) => id);

  // One read-modify-write for the whole batch, not one per tab.
  const unparked = s.stopMidLoad === false ? queued.map((t) => t.id) : [];
  if (failed.length || unparked.length) {
    const pending = await getPending();
    for (const id of [...failed, ...unparked]) pending.add(id);
    await setPending(pending);
  }
  if (done.length) { await bumpStats(done.length); await rememberBatch(done); }
  updateBadge();
  return done.length;
}

// Popup/options commands.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "formDirty") {
    if (sender.tab) markDirty(sender.tab.id, !!msg.dirty).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "suspendAll") {
    suspendAll().then((n) => sendResponse({ suspended: n }));
    return true;
  }
  if (msg.type === "scanNow") { scan().then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === "undoLast") {
    (async () => {
      const { lastBatch = [] } = await chrome.storage.session.get({ lastBatch: [] });
      let n = 0;
      for (const id of lastBatch) { if (await restoreTab(id)) n++; }
      await rememberBatch([]);
      updateBadge();
      sendResponse({ restored: n });
    })();
    return true;
  }
  if (msg.type === "whitelistCurrent") {
    addToWhitelist(msg.host).then(() => sendResponse({ ok: true, host: msg.host }));
    return true;
  }
  if (msg.type === "listSuspended") {
    (async () => {
      const tabs = await suspendedTabs();
      sendResponse({
        tabs: tabs.map((t) => {
          const url = isParked(t) ? parkedOrigin(t) : urlOf(t);
          return {
            id: t.id,
            title: t.title || hostOf(url) || "tab",
            host: hostOf(url),
            favicon: t.favIconUrl || ""
          };
        })
      });
    })();
    return true;
  }
  if (msg.type === "restoreTab") {
    (async () => {
      await restoreTab(msg.tabId);
      updateBadge();
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg.type === "restoreAll") {
    (async () => {
      const tabs = await suspendedTabs();
      let n = 0;
      for (const t of tabs) { if (await restoreTab(t.id)) n++; }
      updateBadge();
      sendResponse({ restored: n });
    })();
    return true;
  }
  if (msg.type === "isWhitelisted") {
    (async () => {
      const { whitelist = [] } = await chrome.storage.sync.get({ whitelist: [] });
      sendResponse({ listed: whitelist.includes(msg.host) });
    })();
    return true;
  }
  if (msg.type === "stats") {
    (async () => {
      const discarded = await suspendedTabs();
      const { lifetimeCount } = await chrome.storage.local.get({ lifetimeCount: 0 });
      const { lastBatch = [] } = await chrome.storage.session.get({ lastBatch: [] });
      sendResponse({
        current: discarded.length,
        currentBytes: discarded.length * EST_BYTES_PER_TAB,
        lifetimeCount,
        canUndo: lastBatch.length > 0
      });
    })();
    return true;
  }
});

// Context menu clicks.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "suspend-this") {
    if (!tab.discarded && await suspendTab(tab, await getSettings())) { await bumpStats(1); await rememberBatch([tab.id]); }
  } else if (info.menuItemId === "never-site") {
    await addToWhitelist(hostOf(urlOf(tab)));
  }
  updateBadge();
});

// Keyboard shortcuts (see manifest "commands").
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "suspend-current") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && !tab.discarded && await suspendTab(tab, await getSettings())) { await bumpStats(1); await rememberBatch([tab.id]); }
  } else if (cmd === "suspend-all") {
    await suspendAll();
  }
  updateBadge();
});

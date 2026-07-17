// TabRest service worker: scans tabs on an alarm, discards idle ones.

const DEFAULTS = {
  enabled: true,
  idleMinutes: 30,      // default idle threshold (minutes) before discard
  skipAudible: true,    // never discard tabs playing sound
  skipPinned: true,     // never discard pinned tabs
  whitelist: [],        // array of hostnames never discarded
  rules: [],            // per-site overrides: [{ host, minutes }]
  autoClose: false,     // OFF by default — auto-close (not just suspend) idle tabs
  autoCloseMinutes: 120 // idle time before an unused tab is closed
};

// Rough RAM estimate per suspended tab (bytes). Chrome frees ~50-150MB per tab.
const EST_BYTES_PER_TAB = 100 * 1024 * 1024;

// tabId -> last active/interaction timestamp (ms)
let lastActive = {};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function touch(tabId) {
  lastActive[tabId] = Date.now();
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

// Discard one tab, counting it toward stats. Returns true if discarded.
async function discardTab(tabId) {
  try {
    await chrome.tabs.discard(tabId);
    await bumpStats(1);
    return true;
  } catch { return false; }
}

// Badge = count of currently discarded tabs.
async function updateBadge() {
  const tabs = await chrome.tabs.query({ discarded: true });
  const n = tabs.length;
  await chrome.action.setBadgeBackgroundColor({ color: "#2b6cff" });
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
}

// Seed timestamps for existing tabs on startup/install.
async function seed() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  for (const t of tabs) lastActive[t.id] = now;
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
chrome.tabs.onActivated.addListener(({ tabId }) => touch(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Discarding a tab fires onUpdated too — don't treat that as user activity,
  // or the idle timer would reset and auto-close could never trigger.
  if (changeInfo.discarded === true) { updateBadge(); return; }
  touch(tabId);
  // Navigating/reloading clears any unsaved-form flag for that tab.
  if (changeInfo.status === "loading") markDirty(tabId, false);
  updateBadge();
});
chrome.tabs.onCreated.addListener((tab) => touch(tab.id));
chrome.tabs.onRemoved.addListener((tabId) => { delete lastActive[tabId]; markDirty(tabId, false); updateBadge(); });

// Protections shared by suspend and close (does NOT check discarded state).
function isProtected(tab, s, dirty) {
  if (tab.active) return true;                 // never touch focused tab
  if (s.skipPinned && tab.pinned) return true;
  if (s.skipAudible && tab.audible) return true;
  if (dirty && dirty.has(tab.id)) return true; // unsaved form input
  const host = hostOf(tab.url);
  if (!host) return true;                       // chrome:// pages etc.
  if (s.whitelist.includes(host)) return true;
  return false;
}

// Skip rule for SUSPEND: protections + already-suspended tabs.
function shouldSkip(tab, s, dirty) {
  if (isProtected(tab, s, dirty)) return true;
  if (tab.discarded) return true;              // already suspended
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
  const dirty = await getDirty();
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  const done = [];
  for (const tab of tabs) {
    const seen = lastActive[tab.id] ?? now;

    // Auto-close pass (opt-in). Applies to idle tabs incl. already-suspended ones,
    // but never to protected tabs (active/pinned/audible/whitelist/unsaved forms).
    if (s.autoClose && !isProtected(tab, s, dirty)) {
      const closeCutoff = now - s.autoCloseMinutes * 60 * 1000;
      if (seen <= closeCutoff) { await closeTab(tab.id); continue; }
    }

    // Suspend pass (unchanged behaviour).
    if (shouldSkip(tab, s, dirty)) continue;
    const minutes = thresholdFor(hostOf(tab.url), s);
    const cutoff = now - minutes * 60 * 1000;
    if (seen <= cutoff && await discardTab(tab.id)) done.push(tab.id);
  }
  if (done.length) await rememberBatch(done);
  updateBadge();
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === "scan") scan(); });

// Suspend all eligible background tabs. Returns count.
async function suspendAll() {
  const s = await getSettings();
  const dirty = await getDirty();
  const tabs = await chrome.tabs.query({ active: false });
  const done = [];
  for (const tab of tabs) {
    if (shouldSkip(tab, s, dirty)) continue;
    if (await discardTab(tab.id)) done.push(tab.id);
  }
  if (done.length) await rememberBatch(done);
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
      for (const id of lastBatch) {
        try { await chrome.tabs.reload(id); n++; } catch {}
      }
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
      const tabs = await chrome.tabs.query({ discarded: true });
      sendResponse({
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title || hostOf(t.url) || "tab",
          host: hostOf(t.url),
          favicon: t.favIconUrl || ""
        }))
      });
    })();
    return true;
  }
  if (msg.type === "restoreTab") {
    chrome.tabs.reload(msg.tabId).then(() => { updateBadge(); sendResponse({ ok: true }); });
    return true;
  }
  if (msg.type === "restoreAll") {
    (async () => {
      const tabs = await chrome.tabs.query({ discarded: true });
      let n = 0;
      for (const t of tabs) { try { await chrome.tabs.reload(t.id); n++; } catch {} }
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
      const discarded = await chrome.tabs.query({ discarded: true });
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
    if (!tab.discarded) { await discardTab(tab.id); await rememberBatch([tab.id]); }
  } else if (info.menuItemId === "never-site") {
    await addToWhitelist(hostOf(tab.url));
  }
  updateBadge();
});

// Keyboard shortcuts (see manifest "commands").
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "suspend-current") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && !tab.discarded) { await discardTab(tab.id); await rememberBatch([tab.id]); }
  } else if (cmd === "suspend-all") {
    await suspendAll();
  }
  updateBadge();
});

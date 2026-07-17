const $ = (id) => document.getElementById(id);

const DEFAULTS = { skipAudible: true, skipPinned: true, whitelist: [], rules: [], autoClose: false, autoCloseMinutes: 120 };

let state = { skipAudible: true, skipPinned: true, whitelist: [], rules: [], autoClose: false, autoCloseMinutes: 120 };

// --- persistence ---
let savedTimer;
async function save() {
  await chrome.storage.sync.set(state);
  const el = $("saved");
  el.classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove("show"), 1200);
}

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  state = {
    skipAudible: s.skipAudible,
    skipPinned: s.skipPinned,
    whitelist: [...(s.whitelist || [])],
    rules: (s.rules || []).map((r) => ({ ...r })),
    autoClose: !!s.autoClose,
    autoCloseMinutes: s.autoCloseMinutes || 120
  };
  $("skipAudible").checked = state.skipAudible;
  $("skipPinned").checked = state.skipPinned;
  $("autoClose").checked = state.autoClose;
  $("autoCloseMin").value = state.autoCloseMinutes;
  updateAutoCloseUI();
  renderWhitelist();
  renderRules();
}

function updateAutoCloseUI() {
  $("autoCloseBody").style.display = state.autoClose ? "block" : "none";
}

// host -> favicon URL, gathered from open tabs (no external requests)
const faviconMap = {};

// --- open-tab host suggestions ---
async function loadOpenHosts() {
  const tabs = await chrome.tabs.query({});
  const hosts = new Set();
  for (const t of tabs) {
    try {
      const h = new URL(t.url).hostname;
      if (h) { hosts.add(h); if (t.favIconUrl && !faviconMap[h]) faviconMap[h] = t.favIconUrl; }
    } catch {}
  }
  const dl = $("openHosts");
  dl.innerHTML = "";
  for (const h of [...hosts].sort()) {
    const o = document.createElement("option");
    o.value = h;
    dl.appendChild(o);
  }
  renderWhitelist(); // favicons may now be available
}

// Small favicon element for a host; falls back to a letter tile.
function chipFavicon(host) {
  if (faviconMap[host]) {
    const img = document.createElement("img");
    img.className = "cfav"; img.alt = ""; img.src = faviconMap[host];
    img.onerror = () => img.replaceWith(letterTile(host));
    return img;
  }
  return letterTile(host);
}
function letterTile(host) {
  const d = document.createElement("span");
  d.className = "cfav ph";
  d.textContent = (host || "?").charAt(0).toUpperCase();
  return d;
}

function cleanHost(v) {
  let h = (v || "").trim().toLowerCase();
  if (!h) return "";
  // let people paste a full URL; keep just the hostname
  try { if (h.includes("/") || h.includes(":")) h = new URL(h.includes("://") ? h : "http://" + h).hostname; } catch {}
  return h;
}

// --- whitelist ---
function renderWhitelist() {
  const box = $("wlList");
  box.innerHTML = "";
  if (!state.whitelist.length) {
    box.innerHTML = '<span class="none">No sites whitelisted yet.</span>';
    return;
  }
  for (const host of state.whitelist) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const label = document.createElement("span");
    label.textContent = host;
    const x = document.createElement("button");
    x.textContent = "×";
    x.title = "Remove";
    x.setAttribute("aria-label", `Remove ${host} from whitelist`);
    x.addEventListener("click", () => {
      state.whitelist = state.whitelist.filter((h) => h !== host);
      renderWhitelist();
      save();
    });
    chip.append(chipFavicon(host), label, x);
    box.appendChild(chip);
  }
}

function addWhitelist() {
  const host = cleanHost($("wlInput").value);
  if (!host) return;
  if (!state.whitelist.includes(host)) state.whitelist.push(host);
  $("wlInput").value = "";
  renderWhitelist();
  save();
}

$("wlAdd").addEventListener("click", addWhitelist);
$("wlInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addWhitelist(); });

// --- per-site rules ---
function renderRules() {
  const box = $("ruleList");
  box.innerHTML = "";
  if (!state.rules.length) {
    box.innerHTML = '<span class="none">No per-site rules. The default idle time applies to everything.</span>';
  }
  state.rules.forEach((rule, i) => {
    const row = document.createElement("div");
    row.className = "rule";

    const host = document.createElement("input");
    host.type = "text";
    host.setAttribute("list", "openHosts");
    host.placeholder = "site (e.g. news.ycombinator.com)";
    host.value = rule.host || "";
    host.addEventListener("change", () => { state.rules[i].host = cleanHost(host.value); host.value = state.rules[i].host; save(); });

    const min = document.createElement("input");
    min.type = "number"; min.min = "1"; min.max = "720";
    min.value = rule.minutes || 30;
    min.addEventListener("change", () => {
      let v = parseInt(min.value, 10) || 30;
      v = Math.max(1, Math.min(720, v));
      min.value = v; state.rules[i].minutes = v; save();
    });

    const unit = document.createElement("span");
    unit.className = "unit"; unit.textContent = "min";

    const del = document.createElement("button");
    del.className = "del"; del.textContent = "×"; del.title = "Remove rule";
    del.setAttribute("aria-label", "Remove rule");
    del.addEventListener("click", () => { state.rules.splice(i, 1); renderRules(); save(); });

    row.append(host, min, unit, del);
    box.appendChild(row);
  });
}

$("ruleAdd").addEventListener("click", () => {
  state.rules.push({ host: "", minutes: 30 });
  renderRules();
});

// --- toggles ---
$("skipAudible").addEventListener("change", () => { state.skipAudible = $("skipAudible").checked; save(); });
$("skipPinned").addEventListener("change", () => { state.skipPinned = $("skipPinned").checked; save(); });

// --- auto-close (advanced, opt-in) ---
$("autoClose").addEventListener("change", () => {
  state.autoClose = $("autoClose").checked;
  updateAutoCloseUI();
  save();
});
$("autoCloseMin").addEventListener("change", () => {
  let v = parseInt($("autoCloseMin").value, 10) || 120;
  v = Math.max(5, Math.min(10080, v));
  $("autoCloseMin").value = v;
  state.autoCloseMinutes = v;
  save();
});

// Keep clean host on save: drop empty-host rules before persisting is handled by SW ignoring blanks.
loadOpenHosts();
load();

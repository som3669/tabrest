# TabRest

Cut Chrome CPU and memory by auto-suspending idle tabs. Suspended tabs stop
running JavaScript, timers, and background work; they reload instantly when you
click them.

## Install (unpacked, for testing)

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `tabrest` folder

## Features

- **Auto-suspend idle tabs** — tabs untouched past your idle threshold get discarded.
- **Whitelist** — hostnames that are never suspended (options page).
- **Skip rules** — never suspend the active tab, audible tabs, or pinned tabs.
- **Suspend all now** — one click to discard every eligible background tab.

## How it works

`chrome.tabs.discard()` unloads a tab from memory. That frees the CPU and RAM the
tab's renderer was using. Chrome shows a placeholder and reloads the page on focus.

A service worker runs a 1-minute alarm, checks each tab's last-interaction time,
and discards ones past the threshold that don't match a skip/whitelist rule.

## Limits

- Cannot reduce Chrome's core process cost (browser, GPU, network service). Only
  tab renderers are controllable by extensions.
- Chrome's built-in **Memory Saver** does something similar; TabRest gives you
  tighter, configurable control.

## Roadmap

- Per-tab CPU detection + auto-suspend runaway tabs (needs `chrome.processes`,
  Chrome Dev/Canary only).
- Badge showing count of suspended tabs.
- Per-site idle thresholds.

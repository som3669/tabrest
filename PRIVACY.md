# TabRest — Privacy Policy

_Last updated: 2026-07-10_

TabRest is designed to protect your privacy. It runs entirely on your own device.

## What data TabRest collects

**None.** TabRest does not collect, transmit, sell, or share any personal data.
There are no analytics, no tracking, no external servers, and no third-party
services. Nothing you do in the browser is ever sent anywhere.

## What TabRest stores (on your device only)

TabRest saves your settings using Chrome's own storage:

- Your preferences (idle time, skip rules)
- Your whitelist of sites that should never be suspended
- Your per-site idle rules
- Simple local counters (e.g. how many tabs were suspended)

Settings are stored via `chrome.storage.sync`, which means Chrome may sync them
across your own signed-in devices. This is handled by Chrome/Google under your
own account — TabRest never sees or transmits this data itself.

## Permissions and why they are needed

- **tabs** — to see which tabs are idle and to suspend (discard) or restore them.
- **storage** — to save your settings and whitelist on your device.
- **alarms** — to periodically check for idle tabs in the background.
- **idle** — to help detect inactivity.
- **contextMenus** — to add the right-click "Suspend this tab" / "Never suspend
  this site" options.
- **Host access (content script)** — a small script runs on web pages only to
  detect whether a form field has unsaved input, so TabRest never suspends a tab
  while you are typing. It checks *whether* a field has changed — it never reads,
  stores, or transmits the contents of what you type.

## Data sharing

TabRest shares no data with anyone. There is nothing to share, because nothing
is collected.

## Changes to this policy

Any changes will be posted on this page with an updated date.

## Contact

For questions about this policy, contact: som.shrestha@themegrill.com

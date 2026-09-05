// Placeholder shown by a parked tab. The original address travels in the hash,
// so nothing is stored and the tab can always be sent back where it came from.
(() => {
  const p = new URLSearchParams(location.hash.slice(1));
  const url = p.get("u") || "";
  const title = p.get("t") || "";
  const fav = p.get("f") || "";

  let host = "";
  try { host = new URL(url).hostname; } catch {}

  document.title = title || host || "Suspended";
  document.getElementById("title").textContent = title || host || "Tab suspended";
  document.getElementById("host").textContent = host;

  // Show the full address, always. If TabRest is ever removed or disabled this
  // page will not load, so the address must also be readable straight from the
  // URL bar — keeping it visible here makes that obvious rather than a surprise.
  document.getElementById("url").textContent = url;

  if (fav) {
    const img = document.getElementById("fav");
    img.src = fav;
    img.hidden = false;
    img.onerror = () => { img.hidden = true; };
  }

  function restore() {
    if (url) location.replace(url);
  }

  document.getElementById("restore").addEventListener("click", restore);

  const copyBtn = document.getElementById("copy");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = "Copied";
      setTimeout(() => { copyBtn.textContent = "Copy address"; }, 1500);
    } catch {
      copyBtn.textContent = "Press Ctrl+C";
    }
  });

  // Enter anywhere on the page brings the tab back.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") restore();
  });
})();

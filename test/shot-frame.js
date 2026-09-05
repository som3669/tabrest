const q = new URLSearchParams(location.search);
if (q.get("h")) document.getElementById("h").textContent = q.get("h");
if (q.get("p")) document.getElementById("p").textContent = q.get("p");
if (q.get("src")) document.getElementById("f").src = q.get("src");

// The popup is a same-origin extension page, so its scrollbars can be hidden
// for the screenshot without touching the shipped stylesheet.
const f = document.getElementById("f");
f.addEventListener("load", () => {
  try {
    const d = f.contentDocument;
    const st = d.createElement("style");
    st.textContent = "::-webkit-scrollbar{width:0;height:0;display:none}";
    d.head.appendChild(st);
  } catch {}
});

// Zero-duty supplier match. Client-side only; reads data/hts/match/NN.json (built from USITC HTS, Special column).
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const P = {
  S: "USMCA: Canada, Mexico", "S+": "USMCA: Canada, Mexico", CA: "USMCA: Canada", MX: "USMCA: Mexico",
  AU: "Australia FTA", BH: "Bahrain FTA", CL: "Chile FTA", CO: "Colombia TPA",
  P: "CAFTA-DR", "P+": "CAFTA-DR", IL: "Israel FTA", JO: "Jordan FTA", KR: "Korea FTA (KORUS)",
  MA: "Morocco FTA", OM: "Oman FTA", PA: "Panama TPA", PE: "Peru TPA", SG: "Singapore FTA",
  A: "GSP (lapsed, dark)", "A*": "GSP (lapsed, dark)", "A+": "GSP (lapsed, dark)",
  D: "AGOA (lit through 2028; eligible countries)", E: "Caribbean Basin (CBERA), check eligibility", R: "CBTPA, check eligibility",
};
let rows = [], meta = null;
const ch = $("chap");
ch.innerHTML = '<option value="">Select…</option>' + Array.from({ length: 97 }, (_, i) => String(i + 1).padStart(2, "0")).filter((c) => c !== "77").map((c) => `<option>${c}</option>`).join("");
fetch("data/hts/meta.json").then((r) => r.json()).then((m) => (meta = m)).catch(() => {});

function parse(raw) { // "Free (AU,BH,...) 2.5% (KR)" -> [{rate, programs}]
  const out = []; const re = /([^()]+?)\s*\(([^)]*)\)/g; let m;
  while ((m = re.exec(raw))) out.push({ rate: m[1].trim().replace(/^[,;]\s*/, ""), progs: m[2].split(",").map((s) => s.trim()).filter(Boolean) });
  return out;
}
function render() {
  const q = $("q").value.trim().toLowerCase(), qd = q.replace(/\./g, "");
  const hits = rows.filter((r) => !q || (/^\d+$/.test(qd) ? r[0].replace(/\./g, "").startsWith(qd) : q.split(/\s+/).every((w) => r[1].toLowerCase().includes(w)))).slice(0, 60);
  $("meta").textContent = `${rows.length} lines in chapter${meta ? `, ${meta.revision} (effective ${meta.effective})` : ""}. Showing ${hits.length}${hits.length === 60 ? " (narrow your filter)" : ""}.`;
  $("out").innerHTML = hits.map(([code, path, gen, sp]) => {
    const parts = sp ? parse(sp) : [];
    const body = parts.length ? parts.map((p) => `<div><b>${esc(p.rate)}</b>: ${p.progs.map((c) => `<span class="prog" title="${esc(c)}">${esc(P[c] || c + " (check HTS)")}</span>`).join("")}</div>`).join("")
      : `<div class="small">No special-rate preference listed${sp ? "" : ""}. ${gen === "Free" ? "General rate is already Free for all origins." : "Check HTS; consider FTZ or drawback."}</div>`;
    return `<div class="row"><code>${esc(code)}</code> <span class="small">${esc(path)}</span><div class="small">General (MFN): <b>${esc(gen || "check HTS")}</b>${sp ? ` · Special column: <code>${esc(sp)}</code>` : ""}</div>${body}</div>`;
  }).join("") || "<p class='small'>No match.</p>";
}
ch.addEventListener("change", async () => {
  if (!ch.value) return;
  $("meta").textContent = "Loading…";
  try { const r = await fetch(`data/hts/match/${ch.value}.json?v=1`); if (!r.ok) throw new Error(`HTTP ${r.status}`); rows = await r.json(); render(); }
  catch (e) { $("meta").textContent = `Could not load chapter: ${e.message}. Check HTS directly.`; }
});
$("q").addEventListener("input", () => { const d = $("q").value.replace(/\D/g, ""); if (d.length >= 2 && d.slice(0, 2) !== ch.value && /^\d/.test($("q").value)) { ch.value = d.slice(0, 2); ch.dispatchEvent(new Event("change")); } else render(); });
$("sf").addEventListener("submit", (e) => {
  e.preventDefault();
  const body = `Product/HTS: ${$("sp").value}\nSupplier country: ${$("sc").value}\n\nI opted in to be contacted about this request. Reply STOP to opt out.`;
  location.href = `mailto:Fitzyracing1@gmail.com?subject=${encodeURIComponent("Zero-duty supplier match request")}&body=${encodeURIComponent(body)}`;
});

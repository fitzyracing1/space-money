// Client-side search over the full US HTS (data/hts/search.json). Runs entirely in the browser; nothing is sent anywhere.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TYPE = { free: "Free", ad_valorem: "ad valorem", specific: "specific", compound: "compound", other: "other (text)", none: "no rate" };
let idx = null, onchain = new Map(), maxAge = 400;
window.addEventListener("tariff-onchain", (e) => { onchain = e.detail.rates; maxAge = e.detail.maxAge; run(); });

async function load() {
  $("htsMeta").textContent = "Loading the full schedule (≈0.5 MB compressed)…";
  const r = await fetch("data/hts/search.json?v=8");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  idx = await r.json();
  idx.rows.forEach((x) => { x.d = x[0].replace(/\./g, ""); x.l = x[1].toLowerCase(); });
  $("htsMeta").innerHTML = `${idx.rows.length.toLocaleString()} lines, ${esc(idx.revision)} (effective ${esc(idx.effective)}). ` +
    `<a href="data/hts/hts_base.csv">CSV</a> · <a href="data/hts/hts_base.json">JSON</a> · <a href="data/hts/additional.csv">Chapter 99 layer</a> · <a href="data/hts/meta.json">source</a> · <a href="data/hts/merkle/root.json">Merkle root</a>`;
  $("q").disabled = false; run();
}

function chainCell(code) {
  const d = code.replace(/\./g, "");
  for (const [c, r] of onchain) {
    const cd = c.replace(/\./g, "");
    if (d === cd || d.startsWith(cd)) {
      const lit = (Date.now() / 1000 - r.at) / 86400 <= maxAge;
      return `<span class="${lit ? "lit" : "dark"}">${lit ? "lit" : "dark"}</span> ${(r.bps / 100).toFixed(2)}% <span class="small">via ${esc(c)}</span>`;
    }
  }
  return `<span class="small">in Merkle set only</span>`;
}

function run() {
  if (!idx) return;
  const q = $("q").value.trim().toLowerCase();
  if (q.length < 2) { $("htsRows").innerHTML = `<tr><td colspan="5" class="small">Type at least 2 characters (a code like 8703.80 or words like "copper wire").</td></tr>`; return; }
  const digits = q.replace(/[.\s]/g, "");
  const byCode = /^\d+$/.test(digits), words = q.split(/\s+/);
  const hits = [];
  for (const x of idx.rows) {
    if (byCode ? x.d.startsWith(digits) : words.every((w) => x.l.includes(w))) { hits.push(x); if (hits.length >= 60) break; }
  }
  $("htsRows").innerHTML = hits.map((x) => {
    const add = (idx.add[x[0]] || []).map((a) => `${esc(a[0])} +${a[2] / 100}% <span class="small">(${esc(a[1])}, ${esc(a[3])})</span>`).join("<br>");
    return `<tr><td><code>${esc(x[0])}</code></td><td class="small">${esc(x[1])}</td><td>${esc(x[2] || "—")}<br><span class="small">${TYPE[x[3]] || esc(x[3])}${x[4] ? " · " + esc(x[4]) : ""}</span></td>` +
      `<td class="small">${add || "—"}</td><td>${chainCell(x[0])}</td></tr>`;
  }).join("") || `<tr><td colspan="5">No match.</td></tr>`;
  $("htsCount").textContent = hits.length >= 60 ? "showing first 60 matches" : `${hits.length} match(es)`;
}

let t; $("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 120); });
load().catch((e) => { $("htsMeta").textContent = `Could not load the schedule: ${e.message}`; });

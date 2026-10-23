// Landed-cost route search. Data: data/landed/landed.json (exported from fitzyracing1/tariff-crypto-crawler).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CHECK = '<span class="chk">check source</span>';
  let D = null, hs = null;
  const money = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function compute(r, dest, value, fr) {
    const cif = value + fr, base = dest === "US" ? value : cif;
    const duty = r.d == null ? null : base * (r.d + r.a) / 100;
    const vat = r.v == null || duty == null ? null : (cif + duty) * r.v / 100;
    const total = cif + (duty || 0) + (vat || 0);
    return { duty, vat, total, complete: !(r.miss && r.miss.length) };
  }

  function findHs(q) {
    const d = q.replace(/\D/g, "");
    const keys = Object.keys(D.hs);
    if (d.length >= 4) return keys.filter((k) => k.startsWith(d.slice(0, 6)));
    const words = q.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) || [];
    if (!words.length) return [];
    return keys.filter((k) => words.every((w) => D.hs[k].desc.toLowerCase().includes(w)));
  }

  function renderMatches() {
    const q = $("q").value.trim();
    const m = q ? findHs(q) : [];
    if (m.length && !m.includes(hs)) hs = m[0];
    $("matches").innerHTML = m.slice(0, 12).map((k) => `<button data-k="${k}" class="${k === hs ? "lit" : ""}">${k}</button>`).join("") +
      (q && !m.length ? '<p class="small">Not in the seeded headings yet: check source (hts.usitc.gov / trade-tariff.service.gov.uk).</p>' : "");
    render();
  }

  function renderSpace() {
    const kg = +$("kg").value || 0, S = D.space;
    $("title").textContent = "Space (orbit): launch cost";
    $("plan").innerHTML = "";
    const h = [`<p><b>No customs tariff or import VAT applies in orbit.</b></p>`];
    if (!kg) h.push('<p class="chk">Enter weight (kg) under "Compare to my plan" to price a launch.</p>');
    S.providers.forEach((p) => {
      let price = null;
      if (kg && p.base_price != null && p.per_kg_above_base != null && !(p.max_kg_per_port && kg > p.max_kg_per_port))
        price = p.base_price + Math.max(0, kg - p.base_kg) * p.per_kg_above_base;
      h.push(`<div class="route"><h3>${esc(p.provider)}: ${esc(p.offer)}</h3>
        <div class="tot">${price == null ? CHECK : "$" + money(price) + ` <span class="small">($${money(price / kg)}/kg)</span>`}</div>
        <div class="kv"><span>Status</span><span>${esc(p.status)}</span><span>As of</span><span>${p.as_of ? esc(p.as_of) : CHECK}</span>
        ${p.excludes ? `<span>Excludes</span><span>${esc(p.excludes)}</span>` : ""}</div>
        <details><summary>Sources</summary>${(p.official || []).concat(p.sources || []).map((u) => `<a href="${esc(u)}" rel="noopener" target="_blank">${esc(u)}</a>`).join("<br>")}</details></div>`);
    });
    h.push(`<p class="small">${esc(S.policy)}</p><ul>${S.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
    $("out").innerHTML = h.join("");
  }

  function render() {
    if (!D) return;
    $("cryptonote").hidden = !$("crypto").checked;
    if ($("dest").value === "SPACE") return renderSpace();
    if (!hs) { $("out").textContent = "Type an HS code or product words."; return; }
    const dest = $("dest").value, org = $("origin").value;
    const value = Math.max(0, +$("val").value || 0), fr = Math.max(0, +$("fr").value || 0);
    let rows = D.hs[hs].dest[dest].filter((r) => org === "any" || r.o === org);
    rows = rows.map((r) => Object.assign({}, r, { c: r.status ? null : compute(r, dest, value, fr) }))
      .sort((a, b) => (a.c ? a.c.total : 1e18) - (b.c ? b.c.total : 1e18) || (a.c && b.c ? b.c.complete - a.c.complete : 0));
    const pr = $("porigin").value && D.hs[hs].dest[dest].find((r) => r.o === $("porigin").value && !r.status);
    const pc = pr ? compute(pr, dest, value, fr) : null;
    $("plan").innerHTML = !$("porigin").value ? "" : !pc ? `<p>My plan (${esc($("porigin").value)}): ${CHECK}</p>` :
      `<div class="route"><h3>My plan: ${esc(pr.n)} (${esc(pr.o)})</h3><div class="tot">${money(pc.total)} ${pc.complete ? "" : '<span class="dark small">partial = check source</span>'}</div>
       <p class="small">${$("qty").value ? esc($("qty").value) + " units" : ""}${$("kg").value ? " · " + esc($("kg").value) + " kg" : ""}${$("qty").value && +$("qty").value ? " · " + money(pc.total / +$("qty").value) + " per unit" : ""}. Specific (per-unit/kg) duties not computed: check source. Switching origin means genuinely sourcing there (rules of origin); transshipment is fraud.</p></div>`;
    $("title").textContent = `HS ${hs} → ${$("dest").selectedOptions[0].text}`;
    const h = [`<p class="small">${esc(D.hs[hs].desc)}</p>`];
    rows.forEach((r, i) => {
      if (!r.c) { h.push(`<div class="route"><h3>${esc(r.o)}</h3>${esc(r.status)}</div>`); return; }
      const c = r.c;
      h.push(`<div class="route"><h3>#${i + 1} ${esc(r.n)} <span class="small">(${esc(r.o)})</span></h3>
        <div class="tot">${money(c.total)} ${c.complete ? '<span class="lit small">all components sourced</span>' : '<span class="dark small">partial: ' + esc(r.miss.join(", ")) + " = check source</span>"}</div>
        ${pc && r.o !== pr.o ? `<p class="${pc.total - c.total > 0 ? "lit" : "dark"}">vs my plan: ${pc.total - c.total >= 0 ? "save " : "costs "}${money(Math.abs(pc.total - c.total))} (${(100 * Math.abs(pc.total - c.total) / pc.total).toFixed(1)}%${pc.total - c.total >= 0 ? " less" : " more"})</p>` : ""}
        <div class="kv">
          <span>Route</span><span>${esc(r.dom ? "domestic / intra-EU" : r.prog)}</span>
          <span>Export (origin)</span><span>${esc(r.ov)}; export duty ${r.x == null ? CHECK : "0"}</span>
          <span>Import duty</span><span>${r.d == null ? CHECK : r.d + "%" + (r.a ? " + " + r.a + "% additional" : "") + " = " + money(c.duty)}</span>
          <span>Import VAT</span><span>${r.v == null ? CHECK : r.v + "% = " + money(c.vat)}</span>
        </div>
        ${r.nlines > 1 ? `<p class="small">${r.nlines} tariff lines under ${hs}; showing cheapest (${esc(r.line)}); up to ${r.dmax}% duty on others. Use a full code.</p>` : ""}
        <details><summary>Notes and sources</summary><ul>${(r.add || []).concat(r.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
        ${(r.src || []).map((s) => /^https?:/.test(s) ? `<a href="${esc(s)}" rel="noopener" target="_blank">${esc(s)}</a>` : esc(s)).join("<br>")}</details></div>`);
    });
    $("out").innerHTML = h.join("");
  }

  fetch("data/landed/landed.json").then((r) => r.json()).then((d) => {
    D = d;
    const origins = {};
    Object.values(d.hs).forEach((x) => Object.values(x.dest).forEach((rs) => rs.forEach((r) => { if (r.n) origins[r.o] = r.n; })));
    Object.keys(origins).sort().forEach((o) => ["origin", "porigin"].forEach((id) => $(id).insertAdjacentHTML("beforeend", `<option value="${o}">${esc(origins[o])} (${o})</option>`)));
    $("comp").innerHTML = d.compliance.map((c) => `<li>${esc(c)}</li>`).join("");
    $("cryptonote").textContent = d.crypto;
    $("src").innerHTML = Object.entries(d.meta).filter(([k]) => k !== "EU").map(([k, m]) =>
      `<p><b>${k}</b>: ${esc((m.sources || []).join(" | "))}${m.fetched ? " (fetched " + esc(m.fetched.join(", ")) + ")" : ""}<br>Gaps: ${esc((m.gaps || []).join("; "))}</p>`).join("") +
      `<p>Generated ${esc(d.generated)}. ${esc(d.valuation)}.</p>`;
    $("q").value = "6109"; renderMatches();
  }).catch((e) => { $("out").textContent = "Could not load data: " + e; });

  $("q").addEventListener("input", renderMatches);
  $("matches").addEventListener("click", (e) => { if (e.target.dataset.k) { hs = e.target.dataset.k; renderMatches(); } });
  ["origin", "dest", "val", "fr", "crypto", "porigin", "qty", "kg"].forEach((id) => $(id).addEventListener("input", render));
})();

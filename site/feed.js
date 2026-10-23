import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

// Read-only list of live mainnet rates + optional CREATE2 deploy of the TFS-1 adapter (admin only).
const V = "6", SCAN = "https://etherscan.io", ROUTE = "ANY->US", MAX_AGE_DAYS = 400, TIMEOUT = 15 * 60 * 1000;
const RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://cloudflare-eth.com"];
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C", SALT_VERSION = "space-money/v1", SOURCE_ID = ethers.encodeBytes32String("USITC-HTS");
const FROM_BLOCK = 26253241;          // oracle deployment block
const TFS1 = "0x89f00515";
const ORACLE_ABI = ["event RateSet(bytes32 indexed key, string route, string hsCode, uint16 bps)",
  "event RateRemoved(bytes32 indexed key)", "function getRate(string,string) view returns (uint16,uint64)"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (e) => { const p = [e?.shortMessage || e?.message || String(e)]; const c = e?.code ?? e?.info?.error?.code; if (c !== undefined) p.push(`code ${c}`); return p.join(" | "); };
const norm = (a) => { if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a.trim())) throw new Error(`invalid address: ${JSON.stringify(a)}`); return ethers.getAddress(a.trim().toLowerCase()); };

function parseCsv(t) {   // small RFC4180 parser for data/hts_sample.csv
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows;
}


async function loadRates() {
  $("maxage").textContent = MAX_AGE_DAYS; $("route").textContent = `route ${ROUTE}`;
  const dep = await (await fetch(`deployments/mainnet.json?v=${V}`)).json();
  const O = dep.contracts.TariffOracle;
  $("oracleLink").href = `${SCAN}/address/${O}#readContract`; $("oracleLink").textContent = O;
  const desc = {};
  try { for (const r of parseCsv(await (await fetch(`data/hts_sample.csv?v=${V}`)).text()).slice(1)) desc[r[0]] = r[3]; } catch {}
  let last;
  for (const u of RPCS) {   // public RPCs are flaky: retry the whole read on the next one
    try { return await readFrom(new ethers.JsonRpcProvider(u, 1, { staticNetwork: true }), O, desc); }
    catch (e) { last = e; console.warn("RPC failed", u, e); }
  }
  throw last;
}

async function readFrom(p, O, desc) {
  const o = new ethers.Contract(O, ORACLE_ABI, p);
  const head = await p.getBlockNumber();
  const seen = new Map();
  for (let a = FROM_BLOCK; a <= head; a += 40_000) {
    for (const l of await o.queryFilter(o.filters.RateSet(), a, Math.min(a + 39_999, head)))
      if (l.args.route === ROUTE) seen.set(l.args.key, l.args.hsCode);
  }
  let codes = [...seen.values()];
  if (!codes.length) codes = Object.keys(desc);   // fallback if logs are unavailable
  const now = Math.floor(Date.now() / 1000), rows = [];
  for (const c of codes) {
    try { const [bps, at] = await o.getRate(ROUTE, c); rows.push({ c, bps: Number(bps), at: Number(at) }); }
    catch (e) { if (e?.code !== "CALL_EXCEPTION") throw e; }   // revert = removed / unset; anything else = RPC trouble
  }
  rows.sort((x, y) => y.bps - x.bps || x.c.localeCompare(y.c));
  $("rates").innerHTML = rows.map((r) => { const ageD = (now - r.at) / 86400, lit = ageD <= MAX_AGE_DAYS;
    return `<tr><td><code>${esc(r.c)}</code></td><td>${(r.bps / 100).toFixed(2)}% <span class="small">(${r.bps} bps)</span></td><td class="small">${esc(desc[r.c] || "")}</td>` +
      `<td class="small">${new Date(r.at * 1000).toISOString().slice(0, 10)}</td><td class="${lit ? "lit" : "dark"}">${lit ? "lit" : "dark"}</td></tr>`; }).join("") || `<tr><td colspan="5">No rates published.</td></tr>`;
  window.dispatchEvent(new CustomEvent("tariff-onchain", { detail: { rates: new Map(rows.map((r) => [r.c, r])), maxAge: MAX_AGE_DAYS } }));
  $("meta").innerHTML = `${rows.length} rates live on <a href="${SCAN}/address/${O}" target="_blank" rel="noopener noreferrer">TariffOracle</a> at block ${head.toLocaleString()}.`;
}

// ---------- optional adapter deploy (CREATE2, smart-wallet safe) ----------
let bp, me, art, dep, adapter, busy = false;
const saltOf = () => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "string", "string"], [me, SALT_VERSION, "TariffFeedAdapter"]));
const initcode = () => ethers.concat([art.bytecode, new ethers.Interface(art.abi).encodeDeploy([dep.contracts.TariffOracle, SOURCE_ID])]);
const deployed = async () => (await bp.getCode(adapter)) !== "0x";

async function showAdapter() {
  const a = new ethers.Contract(adapter, art.abi, bp);
  const [ok, [bps]] = await Promise.all([a.supportsInterface(TFS1), a.tariffRate(ROUTE, "9005.80.40")]);
  $("msg").innerHTML = `<span class="lit">lit</span> Adapter live at <a href="${SCAN}/address/${adapter}" target="_blank" rel="noopener noreferrer">${adapter}</a>. supportsInterface(TFS-1) = ${ok}; tariffRate("${ROUTE}","9005.80.40") = ${bps} bps.`;
  $("deploy").disabled = true;
}

async function connect() {
  if (!window.ethereum) { $("who").textContent = "No wallet found. Open this page in your wallet's in-app browser."; return; }
  [dep, art] = await Promise.all([fetch(`deployments/mainnet.json?v=${V}`).then((r) => r.json()), fetch(`artifacts/TariffFeedAdapter.json?v=${V}`).then((r) => r.json())]);
  const accts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accts) || !accts.length) throw new Error("Wallet returned no accounts.");
  bp = new ethers.BrowserProvider(window.ethereum, "any");
  if ((await bp.getNetwork()).chainId !== 1n) {
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }); } catch {}
    bp = new ethers.BrowserProvider(window.ethereum, "any");
  }
  const net = await bp.getNetwork();
  if (net.chainId !== 1n) { $("who").textContent = `Wrong network (chain ${net.chainId}). Ethereum mainnet only.`; return; }
  me = norm(accts[0]);
  if ((await bp.getCode(FACTORY)) === "0x") throw new Error("CREATE2 factory missing on this chain.");
  adapter = ethers.getCreate2Address(FACTORY, saltOf(), ethers.keccak256(initcode()));
  const smart = (await bp.getCode(me)) !== "0x";
  $("who").innerHTML = `Wallet: <b>${me}</b>${smart ? " (smart wallet)" : ""}<br>Wraps oracle: ${dep.contracts.TariffOracle}<br>Adapter address (CREATE2): <b id="adapterAddr">${adapter}</b>`;
  if (await deployed()) return showAdapter();
  update();
}

async function update() {
  $("deploy").disabled = busy || !$("ack").checked || !me;
  if (!me) return;
  try {
    const data = ethers.concat([saltOf(), initcode()]);
    const [gas, fee] = await Promise.all([bp.estimateGas({ from: me, to: FACTORY, data }), bp.getFeeData()]);
    const g = gas + 100_000n, pr = fee.gasPrice ?? 0n;
    $("est").textContent = `Gas ≈ ${g.toLocaleString()} (incl. ~100k smart-wallet overhead) at ${ethers.formatUnits(pr, "gwei")} gwei ≈ ${Number(ethers.formatEther(g * pr)).toFixed(6)} ETH`;
  } catch (e) { $("est").textContent = "Estimate failed: " + errText(e); }
}

async function deploy() {
  if (!$("ack").checked) return;
  busy = true; $("deploy").disabled = true;
  try {
    if ((await bp.getNetwork()).chainId !== 1n) throw new Error("Wrong network.");
    if (await deployed()) return showAdapter();
    const data = ethers.concat([saltOf(), initcode()]);
    await bp.estimateGas({ from: me, to: FACTORY, data });
    $("msg").textContent = "Confirm in your wallet…";
    const ref = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: me, to: FACTORY, data, value: "0x0" }] });
    const t0 = Date.now();
    while (!(await deployed())) {   // smart wallets return a UserOp hash: confirm by code, not by receipt
      if (Date.now() - t0 > TIMEOUT) throw new Error(`Not confirmed after 15 min (wallet ref ${ref}). Check wallet activity before retrying.`);
      $("msg").textContent = `Sent (wallet ref ${ref}). Waiting for code at ${adapter}… ${Math.round((Date.now() - t0) / 1000)}s`;
      await sleep(3000);
    }
    await showAdapter();
  } catch (e) { $("msg").textContent = "Error: " + errText(e); console.error(e); }
  busy = false;
}

loadRates().catch((e) => { $("meta").textContent = "Error reading chain: " + errText(e); });
$("connect").addEventListener("click", () => connect().catch((e) => ($("who").textContent = "Error: " + errText(e))));
$("ack").addEventListener("change", update);
$("deploy").addEventListener("click", deploy);

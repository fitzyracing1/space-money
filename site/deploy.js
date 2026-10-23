import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

// All contracts are created through the canonical deterministic CREATE2 deployer (Arachnid),
// so the wallet always sends a normal call with a `to` — this works for EOAs and smart wallets
// (Coinbase Smart Wallet cannot send contract-creation txs). Addresses are predictable and every
// step is idempotent: if the on-chain state already matches, the step is skipped.
const CHAIN_ID = 1n;
const SCAN = "https://etherscan.io";
const ROUTE = "ANY->US";
const SHARE_BPS = 2000;
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT_VERSION = "space-money/v1";
const V = "3";
const CONFIRM_TIMEOUT_MS = 15 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (a) => { if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a.trim())) throw new Error(`invalid address: ${JSON.stringify(a)}`); return ethers.getAddress(a.trim().toLowerCase()); };
const errText = (e) => {
  const parts = [e?.shortMessage || e?.message || String(e)];
  const code = e?.code ?? e?.error?.code ?? e?.info?.error?.code; if (code !== undefined) parts.push(`code ${code}`);
  const inner = e?.info?.error?.message || e?.error?.message || e?.data?.message; if (inner && !parts[0].includes(inner)) parts.push(inner);
  if (e?.message && e.message !== parts[0]) parts.push(e.message);
  return parts.join(" | ");
};

let bp, signer, me, smart = false, art = {}, st = {}, ethUsd = null, busy = false, rows = [];
const KEY = () => `space-money-mainnet-deploy:v${SALT_VERSION}:${me}`;
const save = () => localStorage.setItem(KEY(), JSON.stringify(st));
const role = (s) => ethers.id(s);
const coder = ethers.AbiCoder.defaultAbiCoder();

// ---------- deterministic addresses ----------
const saltOf = (name) => ethers.keccak256(coder.encode(["address", "string", "string"], [me, SALT_VERSION, name]));
function initcode(name, args) { return ethers.concat([art[name].bytecode, new ethers.Interface(art[name].abi).encodeDeploy(args)]); }
const ARGS = {
  SpaceToken: () => [me],
  TariffOracle: () => [me],
  Reserve: () => [me, addr.token],
  TariffRouter: () => [me, addr.token, addr.oracle, addr.reserve, me, SHARE_BPS],
};
const addr = {};
function predictAll() {
  for (const [k, n] of [["token", "SpaceToken"], ["oracle", "TariffOracle"], ["reserve", "Reserve"], ["router", "TariffRouter"]])
    addr[k] = ethers.getCreate2Address(FACTORY, saltOf(n), ethers.keccak256(initcode(n, ARGS[n]())));
}
const C = (name, k) => new ethers.Contract(norm(addr[k]), art[name].abi, bp);
const hasCode = async (a) => (await bp.getCode(a)) !== "0x";

// ---------- steps: tx() builds {to,data}; check() returns true when on-chain state is already done ----------
const deployStep = (id, title, name) => ({
  id, title, deploy: name,
  tx: () => ({ to: FACTORY, data: ethers.concat([saltOf(name), initcode(name, ARGS[name]())]) }),
  check: async () => (await hasCode(addr[id])) && (await C(name, id).hasRole(ethers.ZeroHash, me)),
});
const grantStep = (id, title, name, k, r) => ({
  id, title,
  tx: () => ({ to: addr[k], data: new ethers.Interface(art[name].abi).encodeFunctionData("grantRole", [role(r), me]) }),
  check: async () => (await hasCode(addr[k])) && (await C(name, k).hasRole(role(r), me)),
});
const STEPS = [
  deployStep("token", "1. Deploy SpaceToken", "SpaceToken"),
  deployStep("oracle", "2. Deploy TariffOracle", "TariffOracle"),
  deployStep("reserve", "3. Deploy Reserve", "Reserve"),
  deployStep("router", "4. Deploy TariffRouter (treasury = you, 20% reserve)", "TariffRouter"),
  grantStep("gMinter", "5. Grant MINTER_ROLE on SpaceToken to you", "SpaceToken", "token", "MINTER_ROLE"),
  grantStep("gUpdater", "6. Grant UPDATER_ROLE on TariffOracle to you", "TariffOracle", "oracle", "UPDATER_ROLE"),
  grantStep("gConfig", "7. Grant CONFIG_ROLE on TariffRouter to you", "TariffRouter", "router", "CONFIG_ROLE"),
  grantStep("gWithdraw", "8. Grant WITHDRAWER_ROLE on Reserve to you", "Reserve", "reserve", "WITHDRAWER_ROLE"),
  { id: "feed", title: "9. (Optional) Feed 25 USITC HTS rates in one tx", optional: true,
    tx: () => ({ to: addr.oracle, data: new ethers.Interface(art.TariffOracle.abi).encodeFunctionData("setRates",
      [rows.map(() => ROUTE), rows.map((r) => r[0]), rows.map((r) => Number(r[1]))]) }),
    check: async () => {
      if (!(await hasCode(addr.oracle))) return false;
      const o = C("TariffOracle", "oracle");
      for (const r of [rows[0], rows[rows.length - 1]]) {
        let bps, at; try { [bps, at] = await o.getRate(ROUTE, r[0]); } catch { return false; }   // reverts when unset
        if (at === 0n || Number(bps) !== Number(r[1])) return false; }
      return true;
    } },
];

async function loadArtifacts() {
  for (const n of ["SpaceToken", "TariffOracle", "Reserve", "TariffRouter"]) art[n] = await (await fetch(`artifacts/${n}.json?v=${V}`)).json();
  rows = (await (await fetch(`data/hts_sample.csv?v=${V}`)).text()).trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
}

function ready(i) { return STEPS.slice(0, i).every((p) => p.optional || st[p.id]?.done) && !st[STEPS[i].id]?.done; }

function render() {
  $("steps").innerHTML = STEPS.map((s, i) => {
    const d = st[s.id] || {};
    const target = s.deploy ? addr[s.id] : null;
    let info = "";
    if (target) info += `${d.done ? "Address" : "Will deploy to"}: <a href="${SCAN}/address/${target}" target="_blank" rel="noopener noreferrer">${target}</a>`;
    if (d.done) {
      if (d.skipped) info += " · already on-chain (skipped)";
      if (d.tx) info += ` · <a href="${SCAN}/tx/${d.tx}" target="_blank" rel="noopener noreferrer">tx</a>`;
      else if (d.ref) info += ` · wallet ref ${esc(d.ref.slice(0, 12))}…`;
      if (d.gasUsed) info += ` · gas ${Number(d.gasUsed).toLocaleString()}`;
    } else if (d.ref) info += `<br>Pending wallet ref ${esc(d.ref)} — tapping again first re-checks the chain, it won't redeploy.`;
    return `<div class="step ${d.done ? "done" : ""}" id="s-${s.id}"><h3>${esc(s.title)}</h3>
      <div class="st" id="est-${s.id}"></div><div class="st" id="msg-${s.id}">${info}</div>
      ${d.done ? "" : `<button data-i="${i}" ${signer && ready(i) && $("ack").checked && !busy ? "" : "disabled"}>Estimate &amp; send</button>`}</div>`;
  }).join("");
  document.querySelectorAll("#steps button").forEach((b) => b.addEventListener("click", () => run(Number(b.dataset.i))));
  STEPS.forEach((s, i) => { if (signer && ready(i)) estimate(s); });
  const complete = STEPS.every((s) => s.optional || st[s.id]?.done);
  $("result").hidden = !complete;
  if (complete) result();
}

const fmtEth = (wei) => Number(ethers.formatEther(wei)).toFixed(6);
const usd = (wei) => ethUsd ? ` (~$${(Number(ethers.formatEther(wei)) * ethUsd).toFixed(2)})` : "";

async function estimate(s) {
  try {
    const [gas, fee] = await Promise.all([bp.estimateGas({ ...s.tx(), from: me }), bp.getFeeData()]);
    const g = gas + (smart ? 100_000n : 0n);   // smart wallets add UserOp overhead
    const p = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
    $(`est-${s.id}`).textContent = `Expected gas ≈ ${g.toLocaleString()}${smart ? " (incl. ~100k smart-wallet overhead)" : ""} · at ${ethers.formatUnits(p, "gwei")} gwei ≈ ${fmtEth(g * p)} ETH${usd(g * p)}`;
  } catch (e) { $(`est-${s.id}`).textContent = "Estimate failed: " + errText(e); }
}

async function guardChain() {
  const net = await bp.getNetwork();
  if (net.chainId !== CHAIN_ID) throw new Error(`Wrong network (chain ${net.chainId}). Switch to Ethereum mainnet (chain 1).`);
}

async function waitDone(s, msg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await s.check()) return true;
    msg.textContent = `Waiting for on-chain confirmation… ${Math.round((Date.now() - t0) / 1000)}s (checking ${s.deploy ? "contract code at " + addr[s.id] : "contract state"})`;
    await sleep(3000);
  }
  return false;
}

async function run(i) {
  const s = STEPS[i]; const msg = $(`msg-${s.id}`);
  if (!$("ack").checked) { msg.textContent = "Tick the acknowledgement first."; return; }
  busy = true; document.querySelectorAll("#steps button").forEach((b) => (b.disabled = true));
  try {
    await guardChain();
    if (await s.check()) { st[s.id] = { ...(st[s.id] || {}), done: true, skipped: !st[s.id]?.ref }; save(); busy = false; render(); return; }
    if (st[s.id]?.ref) {   // resume: a previous send may still be landing
      msg.textContent = "Previous send found — re-checking the chain before sending again…";
      if (await waitDone(s, msg, 60_000)) { st[s.id].done = true; save(); busy = false; render(); return; }
    }
    const tx = s.tx();
    const gas = await bp.estimateGas({ ...tx, from: me });   // also surfaces reverts before the wallet prompt
    msg.textContent = "Confirm in your wallet…";
    const req = { from: me, to: norm(tx.to), data: tx.data, value: "0x0" };
    if (!smart) req.gas = ethers.toQuantity(gas * 125n / 100n);   // smart wallets size their own UserOp gas
    const ref = await window.ethereum.request({ method: "eth_sendTransaction", params: [req] });
    if (typeof ref !== "string" || !ref) throw new Error(`Wallet returned no reference: ${JSON.stringify(ref)}`);
    st[s.id] = { ref }; save();   // persisted before waiting, so a reload never redeploys
    msg.innerHTML = `Sent (wallet ref ${esc(ref)}). Waiting for on-chain confirmation…`;
    if (!(await waitDone(s, msg, CONFIRM_TIMEOUT_MS))) throw new Error("Not confirmed on-chain yet. Check your wallet's activity, then tap again — the page re-checks before resending.");
    const rec = { ref, done: true };
    // On an EOA the reference is a real L1 tx hash; on a smart wallet it may be a UserOp hash with no receipt.
    try { const rc = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [ref] }); if (rc?.blockNumber) { rec.tx = ref; rec.gasUsed = BigInt(rc.gasUsed).toString(); } } catch {}
    st[s.id] = rec; save();
  } catch (e) {
    $(`s-${s.id}`).classList.add("err");
    msg.textContent = "Error: " + errText(e); console.error(e);
    busy = false; document.querySelectorAll("#steps button").forEach((b) => (b.disabled = false));
    return;
  }
  busy = false; render();
}

async function verifyRoles() {
  const t = C("SpaceToken", "token"), o = C("TariffOracle", "oracle"), r = C("Reserve", "reserve"), x = C("TariffRouter", "router");
  const A = ethers.ZeroHash, ok = [];
  const checks = [["token admin", t.hasRole(A, me)], ["minter", t.hasRole(role("MINTER_ROLE"), me)], ["oracle admin", o.hasRole(A, me)],
    ["updater", o.hasRole(role("UPDATER_ROLE"), me)], ["reserve admin", r.hasRole(A, me)], ["withdrawer", r.hasRole(role("WITHDRAWER_ROLE"), me)],
    ["router admin", x.hasRole(A, me)], ["config", x.hasRole(role("CONFIG_ROLE"), me)], ["factory has no admin", t.hasRole(A, FACTORY).then((v) => !v)]];
  for (const [n, p] of checks) ok.push(`${n}: ${(await p) ? "✓" : "✗"}`);
  ok.push(`treasury = you: ${norm(await x.treasury()) === me ? "✓" : "✗"}`);
  return ok.join(" · ");
}

async function result() {
  const names = { token: "SpaceToken", oracle: "TariffOracle", reserve: "Reserve", router: "TariffRouter" };
  $("addrs").innerHTML = Object.entries(names).map(([k, n]) =>
    `${n}: <a href="${SCAN}/address/${addr[k]}" target="_blank" rel="noopener noreferrer">${addr[k]}</a>`).join("<br>") + `<br><span id="roles">Checking roles…</span>`;
  const out = {
    network: "mainnet", chainId: 1, deployedAt: new Date().toISOString().slice(0, 10),
    deployer: FACTORY, deployMethod: "CREATE2 via deterministic deployer", saltVersion: SALT_VERSION,
    admin: me, adminIsSmartWallet: smart, treasury: me, oracleUpdater: me, reserveShareBps: SHARE_BPS,
    contracts: Object.fromEntries(Object.entries(names).map(([k, n]) => [n, addr[k]])),
    salts: Object.fromEntries(Object.values(names).map((n) => [n, saltOf(n)])),
    transactions: Object.fromEntries(STEPS.filter((s) => st[s.id]?.done && (st[s.id].tx || st[s.id].ref)).map((s) => [s.id, st[s.id].tx || st[s.id].ref])),
    ratesFed: Boolean(st.feed?.done), verified: false,
  };
  $("json").value = JSON.stringify(out, null, 2);
  try { $("roles").textContent = await verifyRoles(); } catch (e) { $("roles").textContent = "Role check failed: " + errText(e); }
}

async function connect() {
  if (!window.ethereum) { $("who").textContent = "No wallet found. Open this page in the Coinbase / Base wallet's in-app browser."; return; }
  bp = new ethers.BrowserProvider(window.ethereum, "any");
  const accts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accts) || !accts.length) throw new Error("Wallet returned no accounts. Unlock the wallet and tap Connect again.");
  let net = await bp.getNetwork();
  if (net.chainId !== CHAIN_ID) {
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }); } catch {}
    bp = new ethers.BrowserProvider(window.ethereum, "any"); net = await bp.getNetwork();
  }
  if (net.chainId !== CHAIN_ID) { $("who").textContent = `Wrong network (chain ${net.chainId}). This page only works on Ethereum mainnet (chain 1).`; return; }
  me = norm(accts[0]);
  signer = await bp.getSigner(me); me = norm(await signer.getAddress());
  if (!(await hasCode(FACTORY))) { $("who").textContent = `CREATE2 deployer ${FACTORY} not found on this chain — stopping.`; signer = null; return; }
  smart = await hasCode(me);
  st = JSON.parse(localStorage.getItem(KEY()) || "{}");
  predictAll();
  for (const s of STEPS) { try { if (await s.check()) st[s.id] = { ...(st[s.id] || {}), done: true, skipped: !st[s.id]?.ref }; } catch {} }
  save();
  const bal = await bp.getBalance(me);
  $("who").innerHTML = `Using wallet: <b id="using">${me}</b><br>` +
    (smart ? `<b id="smart">Smart wallet detected: using factory deploy</b><br>` : `Standard account (EOA): using factory deploy<br>`) +
    `Connected on chain 1 · balance ${fmtEth(bal)} ETH${usd(bal)}`;
  const fee = await bp.getFeeData();
  const est = 8_000_000n * (fee.gasPrice ?? 0n);
  $("gas").textContent = `Current gas price ${ethers.formatUnits(fee.gasPrice ?? 0n, "gwei")} gwei. Whole flow ≈ 6.5–8M gas ≈ up to ${fmtEth(est)} ETH${usd(est)}.`;
  window.ethereum.on?.("chainChanged", () => location.reload());
  window.ethereum.on?.("accountsChanged", () => location.reload());
  render();
}

fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { referrerPolicy: "no-referrer" })
  .then((r) => r.json()).then((j) => { ethUsd = j?.ethereum?.usd ?? null; }).catch(() => {});
$("connect").addEventListener("click", () => connect().catch((e) => ($("who").textContent = "Error: " + errText(e))));
$("ack").addEventListener("change", () => signer && render());
$("reset").addEventListener("click", () => { if (me && confirm("Forget saved progress on this device? (On-chain contracts are unaffected; the page re-detects them.)")) { localStorage.removeItem(KEY()); st = {}; render(); } });
$("copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("json").value); $("copy").textContent = "Copied ✓"; } catch { $("json").select(); document.execCommand("copy"); } });
loadArtifacts().then(render).catch((e) => ($("who").textContent = "Failed to load contract artifacts: " + errText(e)));

import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

const CHAIN_ID = 1n;
const SCAN = "https://etherscan.io";
const ROUTE = "ANY->US";
const SHARE_BPS = 2000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const V = "2";
const norm = (a) => { if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a.trim())) throw new Error(`invalid address: ${JSON.stringify(a)}`); return ethers.getAddress(a.trim().toLowerCase()); };
const errText = (e) => {
  const parts = [e?.shortMessage || e?.message || String(e)];
  const code = e?.code ?? e?.error?.code ?? e?.info?.error?.code; if (code !== undefined) parts.push(`code ${code}`);
  const inner = e?.info?.error?.message || e?.error?.message || e?.data?.message; if (inner && !parts[0].includes(inner)) parts.push(inner);
  if (e?.message && e.message !== parts[0]) parts.push(e.message);
  return parts.join(" | ");
};
// Minimal JSON-RPC tx: only defined keys, hex quantities, and NO "to" key for contract creation.
function rpcTx(tx, gasLimit) {
  const o = { from: norm(me), data: tx.data, gas: ethers.toQuantity(gasLimit) };
  if (tx.to !== undefined && tx.to !== null && tx.to !== "") o.to = norm(tx.to);
  if (tx.value) o.value = ethers.toQuantity(tx.value);
  return o;
}
const isInvalidAddr = (e) => /invalid address/i.test(errText(e));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Poll the receipt over raw JSON-RPC and parse it ourselves, so a wallet that reports `to: ""` (or odd casing) can't break us.
async function waitReceipt(hash) {
  for (;;) {
    const r = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (r && r.blockNumber) return { hash, status: Number(r.status), gasUsed: BigInt(r.gasUsed), contractAddress: r.contractAddress || null };
    await sleep(3000);
  }
}
async function sendRaw(tx, gasLimit) {
  const o = rpcTx(tx, gasLimit);
  try { return await window.ethereum.request({ method: "eth_sendTransaction", params: [o] }); }
  catch (e) {
    // Rejected before signing (nothing broadcast): retry once with lowercase addresses, which some wallets prefer.
    if (!isInvalidAddr(e)) throw e;
    const lo = { ...o, from: o.from.toLowerCase(), ...(o.to ? { to: o.to.toLowerCase() } : {}) };
    return await window.ethereum.request({ method: "eth_sendTransaction", params: [lo] });
  }
}
let bp, signer, me, art = {}, st = {}, ethUsd = null, busy = false;
const KEY = () => `space-money-mainnet-deploy:${me}`;
const save = () => localStorage.setItem(KEY(), JSON.stringify(st));

const C = (name, rec) => new ethers.Contract(norm(rec.address), art[name].abi, signer);
const role = (s) => ethers.id(s);

// Each step: build() returns an unsigned tx request; after() records the result.
const STEPS = [
  { id: "token", title: "1. Deploy SpaceToken", deploy: "SpaceToken", args: () => [me] },
  { id: "oracle", title: "2. Deploy TariffOracle", deploy: "TariffOracle", args: () => [me] },
  { id: "reserve", title: "3. Deploy Reserve", deploy: "Reserve", args: () => [me, st.token.address] },
  { id: "router", title: "4. Deploy TariffRouter (treasury = you, 20% reserve)", deploy: "TariffRouter",
    args: () => [me, st.token.address, st.oracle.address, st.reserve.address, me, SHARE_BPS] },
  { id: "gMinter", title: "5. Grant MINTER_ROLE on SpaceToken to you", call: () => C("SpaceToken", st.token).grantRole.populateTransaction(role("MINTER_ROLE"), me) },
  { id: "gUpdater", title: "6. Grant UPDATER_ROLE on TariffOracle to you", call: () => C("TariffOracle", st.oracle).grantRole.populateTransaction(role("UPDATER_ROLE"), me) },
  { id: "gConfig", title: "7. Grant CONFIG_ROLE on TariffRouter to you", call: () => C("TariffRouter", st.router).grantRole.populateTransaction(role("CONFIG_ROLE"), me) },
  { id: "gWithdraw", title: "8. Grant WITHDRAWER_ROLE on Reserve to you", call: () => C("Reserve", st.reserve).grantRole.populateTransaction(role("WITHDRAWER_ROLE"), me) },
  { id: "feed", title: "9. (Optional) Feed 25 USITC HTS rates in one tx", optional: true, call: feedTx },
];

async function loadArtifacts() {
  for (const n of ["SpaceToken", "TariffOracle", "Reserve", "TariffRouter"]) art[n] = await (await fetch(`artifacts/${n}.json?v=${V}`)).json();
}

async function feedTx() {
  const text = await (await fetch("data/hts_sample.csv")).text();
  const rows = text.trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
  return C("TariffOracle", st.oracle).setRates.populateTransaction(rows.map(() => ROUTE), rows.map((r) => r[0]), rows.map((r) => Number(r[1])));
}

async function buildTx(s) {
  if (s.deploy) {
    const f = new ethers.ContractFactory(art[s.deploy].abi, art[s.deploy].bytecode, signer);
    const d = await f.getDeployTransaction(...s.args());
    return { data: d.data };            // creation: data only, never a "to" key
  }
  const c = await s.call();
  return { to: norm(c.to), data: c.data };
}

function ready(i) { return STEPS.slice(0, i).every((p) => p.optional || st[p.id]) && !st[STEPS[i].id]; }

function render() {
  $("steps").innerHTML = STEPS.map((s, i) => {
    const done = st[s.id];
    const info = done ? (s.deploy ? `Address: <a href="${SCAN}/address/${done.address}" target="_blank" rel="noopener noreferrer">${done.address}</a>` : "")
      + ` · <a href="${SCAN}/tx/${done.tx}" target="_blank" rel="noopener noreferrer">tx</a> · gas ${Number(done.gasUsed).toLocaleString()}` : "";
    return `<div class="step ${done ? "done" : ""}" id="s-${s.id}"><h3>${esc(s.title)}</h3>
      <div class="st" id="est-${s.id}"></div><div class="st" id="msg-${s.id}">${info}</div>
      ${done ? "" : `<button data-i="${i}" ${signer && ready(i) && $("ack").checked && !busy ? "" : "disabled"}>Estimate &amp; send</button>`}</div>`;
  }).join("");
  document.querySelectorAll("#steps button").forEach((b) => b.addEventListener("click", () => run(Number(b.dataset.i))));
  STEPS.forEach((s, i) => { if (signer && ready(i) && !st[s.id]) estimate(s); });
  const complete = STEPS.every((s) => s.optional || st[s.id]);
  $("result").hidden = !complete;
  if (complete) result();
}

const fmtEth = (wei) => Number(ethers.formatEther(wei)).toFixed(6);
const usd = (wei) => ethUsd ? ` (~$${(Number(ethers.formatEther(wei)) * ethUsd).toFixed(2)})` : "";

async function estimate(s) {
  try {
    const tx = await buildTx(s);
    const [gas, fee] = await Promise.all([bp.estimateGas({ ...tx, from: norm(me) }), bp.getFeeData()]);
    const price = fee.maxFeePerGas ?? fee.gasPrice;
    $(`est-${s.id}`).textContent = `Expected gas ≈ ${gas.toLocaleString()} · at ${ethers.formatUnits(fee.gasPrice ?? price, "gwei")} gwei ≈ ${fmtEth(gas * (fee.gasPrice ?? price))} ETH${usd(gas * (fee.gasPrice ?? price))} · max ${fmtEth(gas * price)} ETH`;
  } catch (e) { $(`est-${s.id}`).textContent = "Estimate failed: " + errText(e); }
}

async function guardChain() {
  const net = await bp.getNetwork();
  if (net.chainId !== CHAIN_ID) throw new Error(`Wrong network (chain ${net.chainId}). Switch to Ethereum mainnet (chain 1).`);
}

async function run(i) {
  const s = STEPS[i]; const msg = $(`msg-${s.id}`);
  if (!$("ack").checked) { msg.textContent = "Tick the acknowledgement first."; return; }
  busy = true; document.querySelectorAll("#steps button").forEach((b) => (b.disabled = true));
  try {
    await guardChain();
    msg.textContent = "Preparing… then confirm in your wallet.";
    const tx = await buildTx(s);
    const gas = await bp.estimateGas({ ...tx, from: norm(me) });
    let hash = st[s.id + "_pending"];
    if (hash) msg.textContent = `Resuming pending tx ${hash}…`;
    else {
      hash = await sendRaw(tx, gas * 125n / 100n);
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`Wallet returned an unexpected tx hash: ${JSON.stringify(hash)}`);
      st[s.id + "_pending"] = hash; save();   // remember before waiting, so a reload/error never double-sends
    }
    msg.innerHTML = `Sent: <a href="${SCAN}/tx/${hash}" target="_blank" rel="noopener noreferrer">${hash}</a>. Waiting for confirmation…`;
    const rc = await waitReceipt(hash);
    if (!rc || rc.status !== 1) throw new Error("Transaction failed on-chain. Check it on Etherscan before retrying.");
    const rec = { tx: rc.hash, gasUsed: rc.gasUsed.toString() };
    if (s.deploy) {
      rec.address = norm(rc.contractAddress);
      if ((await bp.getCode(rec.address)) === "0x") throw new Error("No code at deployed address.");
    }
    st[s.id] = rec; delete st[s.id + "_pending"]; save();
  } catch (e) {
    $(`s-${s.id}`).classList.add("err");
    msg.textContent = "Error: " + errText(e); console.error(e);
    busy = false; document.querySelectorAll("#steps button").forEach((b) => (b.disabled = false));
    return;
  }
  busy = false; render();
}

async function verifyRoles() {
  const ok = [];
  const t = C("SpaceToken", st.token), o = C("TariffOracle", st.oracle), r = C("Reserve", st.reserve), x = C("TariffRouter", st.router);
  const A = ethers.ZeroHash;
  const checks = [["token admin", t.hasRole(A, me)], ["minter", t.hasRole(role("MINTER_ROLE"), me)], ["oracle admin", o.hasRole(A, me)],
    ["updater", o.hasRole(role("UPDATER_ROLE"), me)], ["reserve admin", r.hasRole(A, me)], ["withdrawer", r.hasRole(role("WITHDRAWER_ROLE"), me)],
    ["router admin", x.hasRole(A, me)], ["config", x.hasRole(role("CONFIG_ROLE"), me)]];
  for (const [n, p] of checks) ok.push(`${n}: ${(await p) ? "✓" : "✗"}`);
  ok.push(`treasury = you: ${(await x.treasury()).toLowerCase() === me.toLowerCase() ? "✓" : "✗"}`);
  return ok.join(" · ");
}

async function result() {
  const names = { token: "SpaceToken", oracle: "TariffOracle", reserve: "Reserve", router: "TariffRouter" };
  $("addrs").innerHTML = Object.entries(names).map(([k, n]) =>
    `${n}: <a href="${SCAN}/address/${st[k].address}" target="_blank" rel="noopener noreferrer">${st[k].address}</a>`).join("<br>") + `<br><span id="roles">Checking roles…</span>`;
  const out = {
    network: "mainnet", chainId: 1, deployedAt: new Date().toISOString().slice(0, 10), deployer: me, admin: me, treasury: me,
    oracleUpdater: me, reserveShareBps: SHARE_BPS,
    contracts: Object.fromEntries(Object.entries(names).map(([k, n]) => [n, st[k].address])),
    transactions: Object.fromEntries(STEPS.filter((s) => st[s.id]).map((s) => [s.id, st[s.id].tx])),
    gasUsed: Object.fromEntries(STEPS.filter((s) => st[s.id]).map((s) => [s.id, Number(st[s.id].gasUsed)])),
    ratesFed: Boolean(st.feed), verified: false,
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
  st = JSON.parse(localStorage.getItem(KEY()) || "{}");
  const bal = await bp.getBalance(me);
  $("who").innerHTML = `Using wallet: <b id="using">${me}</b><br>Connected on chain 1 · balance ${fmtEth(bal)} ETH${usd(bal)}`;
  const fee = await bp.getFeeData();
  const est = 40_000_000n * (fee.gasPrice ?? 0n);
  $("gas").textContent = `Current gas price ${ethers.formatUnits(fee.gasPrice ?? 0n, "gwei")} gwei. Whole flow ≈ 40M gas ≈ ${fmtEth(est)} ETH${usd(est)} (upper bound).`;
  window.ethereum.on?.("chainChanged", () => location.reload());
  window.ethereum.on?.("accountsChanged", () => location.reload());
  render();
}

fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { referrerPolicy: "no-referrer" })
  .then((r) => r.json()).then((j) => { ethUsd = j?.ethereum?.usd ?? null; }).catch(() => {});
$("connect").addEventListener("click", () => connect().catch((e) => ($("who").textContent = "Error: " + errText(e))));
$("ack").addEventListener("change", () => signer && render());
$("reset").addEventListener("click", () => { if (me && confirm("Forget saved addresses on this device? (On-chain contracts are unaffected.)")) { localStorage.removeItem(KEY()); st = {}; render(); } });
$("copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("json").value); $("copy").textContent = "Copied ✓"; } catch { $("json").select(); document.execCommand("copy"); } });
loadArtifacts().then(render);

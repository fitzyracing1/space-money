import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

const V = "1", CHAIN_ID = 1n, SCAN = "https://etherscan.io", TIMEOUT = 15 * 60 * 1000;
const MINTER_ROLE = ethers.id("MINTER_ROLE");
const ABI = ["function mint(address,uint256)", "function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)", "function symbol() view returns (string)", "function hasRole(bytes32,address) view returns (bool)"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (a) => { if (typeof a !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(a.trim())) throw new Error(`invalid address: ${JSON.stringify(a)}`); return ethers.getAddress(a.trim().toLowerCase()); };
const errText = (e) => { const p = [e?.shortMessage || e?.message || String(e)]; const c = e?.code ?? e?.info?.error?.code; if (c !== undefined) p.push(`code ${c}`);
  const i = e?.info?.error?.message || e?.error?.message; if (i && !p[0].includes(i)) p.push(i); return p.join(" | "); };

let bp, me, token, dec = 18n, sym = "SPACE", ethUsd = null, busy = false, dep;
const fmt = (v) => Number(ethers.formatUnits(v, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const fmtEth = (w) => Number(ethers.formatEther(w)).toFixed(6);
const usd = (w) => ethUsd ? ` (~$${(Number(ethers.formatEther(w)) * ethUsd).toFixed(2)})` : "";

function parseForm() {
  const raw = $("amount").value.replace(/[,_\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) throw new Error("Enter a positive amount.");
  return { to: norm($("to").value), amount: ethers.parseUnits(raw, dec) };
}

async function refresh() {
  const [ts, bal] = await Promise.all([token.totalSupply(), token.balanceOf(me)]);
  $("supply").innerHTML = `Total supply: <b>${fmt(ts)} ${esc(sym)}</b><br>Your balance: <b id="bal">${fmt(bal)} ${esc(sym)}</b>`;
}

async function update() {
  let f; try { f = parseForm(); } catch (e) { $("est").textContent = e.message; $("mint").disabled = true; $("towarn").hidden = true; return; }
  $("towarn").hidden = f.to === me;
  $("mint").disabled = busy || !$("ack").checked;
  try {
    const data = token.interface.encodeFunctionData("mint", [f.to, f.amount]);
    const [gas, fee] = await Promise.all([bp.estimateGas({ from: me, to: dep.contracts.SpaceToken, data }), bp.getFeeData()]);
    const g = gas + 100_000n, p = fee.gasPrice ?? 0n;   // + smart-wallet UserOp overhead
    $("est").textContent = `Mint ${fmt(f.amount)} ${sym} → ${f.to}. Gas ≈ ${g.toLocaleString()} (incl. ~100k smart-wallet overhead) at ${ethers.formatUnits(p, "gwei")} gwei ≈ ${fmtEth(g * p)} ETH${usd(g * p)}`;
  } catch (e) { $("est").textContent = "Estimate failed: " + errText(e); }
}

async function mint() {
  const msg = $("msg");
  if (!$("ack").checked) { msg.textContent = "Tick the box first."; return; }
  busy = true; $("mint").disabled = true;
  try {
    if ((await bp.getNetwork()).chainId !== CHAIN_ID) throw new Error("Wrong network. Switch to Ethereum mainnet (chain 1).");
    const f = parseForm();
    if (!(await token.hasRole(MINTER_ROLE, me))) throw new Error(`${me} does not hold MINTER_ROLE on ${dep.contracts.SpaceToken}.`);
    const before = await token.balanceOf(f.to);
    const data = token.interface.encodeFunctionData("mint", [f.to, f.amount]);
    await bp.estimateGas({ from: me, to: dep.contracts.SpaceToken, data });   // surfaces reverts before the wallet prompt
    msg.textContent = "Confirm in your wallet…";
    const ref = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: me, to: norm(dep.contracts.SpaceToken), data, value: "0x0" }] });
    if (typeof ref !== "string" || !ref) throw new Error(`Wallet returned no reference: ${JSON.stringify(ref)}`);
    const t0 = Date.now();
    for (;;) {   // smart wallets return a UserOp hash: confirm by state, not by receipt
      const now = await token.balanceOf(f.to);
      if (now >= before + f.amount) break;
      if (Date.now() - t0 > TIMEOUT) throw new Error(`Not confirmed after 15 min (wallet ref ${ref}). Check your wallet activity before minting again.`);
      msg.textContent = `Sent (wallet ref ${ref}). Waiting for balance to update… ${Math.round((Date.now() - t0) / 1000)}s`;
      await sleep(3000);
    }
    msg.innerHTML = `✓ Minted ${fmt(f.amount)} ${esc(sym)} to <a href="${SCAN}/token/${dep.contracts.SpaceToken}?a=${f.to}" target="_blank" rel="noopener noreferrer">${f.to}</a>. Wallet ref ${esc(ref)}`;
    await refresh();
  } catch (e) { msg.textContent = "Error: " + errText(e); console.error(e); }
  busy = false; update();
}

async function connect() {
  if (!window.ethereum) { $("who").textContent = "No wallet found. Open this page in the Coinbase / Base wallet's in-app browser."; return; }
  dep = await (await fetch(`deployments/mainnet.json?v=${V}`)).json();
  if (dep.chainId !== 1) throw new Error("deployments/mainnet.json is not chain 1.");
  bp = new ethers.BrowserProvider(window.ethereum, "any");
  const accts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accts) || !accts.length) throw new Error("Wallet returned no accounts.");
  let net = await bp.getNetwork();
  if (net.chainId !== CHAIN_ID) {
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }); } catch {}
    bp = new ethers.BrowserProvider(window.ethereum, "any"); net = await bp.getNetwork();
  }
  if (net.chainId !== CHAIN_ID) { $("who").textContent = `Wrong network (chain ${net.chainId}). This page only works on Ethereum mainnet (chain 1).`; return; }
  me = norm(accts[0]);
  if ((await bp.getCode(dep.contracts.SpaceToken)) === "0x") throw new Error(`No contract at ${dep.contracts.SpaceToken} on this chain.`);
  token = new ethers.Contract(norm(dep.contracts.SpaceToken), ABI, bp);
  [dec, sym] = await Promise.all([token.decimals().then(BigInt), token.symbol()]);
  const [smart, isMinter, bal] = await Promise.all([bp.getCode(me).then((c) => c !== "0x"), token.hasRole(MINTER_ROLE, me), bp.getBalance(me)]);
  $("who").innerHTML = `Using wallet: <b id="using">${me}</b>${smart ? " (smart wallet)" : ""}<br>Token: <a href="${SCAN}/token/${dep.contracts.SpaceToken}" target="_blank" rel="noopener noreferrer">${dep.contracts.SpaceToken}</a><br>` +
    `MINTER_ROLE: <b id="role">${isMinter ? "✓ yes" : "✗ no — minting will be refused"}</b> · ETH ${fmtEth(bal)}${usd(bal)}`;
  if (!$("to").value) $("to").value = me;
  await refresh(); update();
}

fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { referrerPolicy: "no-referrer" })
  .then((r) => r.json()).then((j) => { ethUsd = j?.ethereum?.usd ?? null; }).catch(() => {});
$("connect").addEventListener("click", () => connect().catch((e) => ($("who").textContent = "Error: " + errText(e))));
for (const id of ["amount", "to", "ack"]) $(id).addEventListener("input", () => me && update());
$("ack").addEventListener("change", () => me && update());
$("mint").addEventListener("click", mint);

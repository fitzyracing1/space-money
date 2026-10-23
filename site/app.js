import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

const CHAIN_ID = 11155111n;
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SCAN = "https://sepolia.etherscan.io";
const REPO = "https://github.com/fitzyracing1/space-money";
const ROUTE = "ANY->US";

const ERC20 = ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const ORACLE = ["function getRate(string,string) view returns (uint16,uint64)"];
const ROUTER = ["function reserveShareBps() view returns (uint16)",
  "function quote(string,string,uint256) view returns (uint256,uint256,uint256)",
  "function payTariff(bytes32,string,string,uint256,uint256) returns (uint256)"];

const $ = (id) => document.getElementById(id);
const fmt = (v) => Number(ethers.formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const provider = new ethers.JsonRpcProvider(RPC, Number(CHAIN_ID), { staticNetwork: true });
let dep, token, oracle, router, rates = [], signer = null, shareBps = 2000n;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).slice(1);
  return lines.map((l) => {
    const cells = []; let cur = "", q = false;
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { cells.push(cur); cur = ""; } else cur += ch; }
    cells.push(cur);
    return { hts: cells[0], desc: cells[3] };
  });
}

async function init() {
  dep = await (await fetch("deployments/sepolia.json")).json();
  const c = dep.contracts;
  token = new ethers.Contract(c.SpaceToken, ERC20, provider);
  oracle = new ethers.Contract(c.TariffOracle, ORACLE, provider);
  router = new ethers.Contract(c.TariffRouter, ROUTER, provider);
  $("route").textContent = `route ${ROUTE}`;
  links();
  const [supply, res, share] = await Promise.all([token.totalSupply(), token.balanceOf(c.Reserve), router.reserveShareBps()]);
  shareBps = share;
  $("supply").textContent = fmt(supply) + " SPACE";
  $("reserve").textContent = fmt(res) + " SPACE";
  $("share").textContent = (Number(share) / 100) + "%";
  const sample = parseCsv(await (await fetch("data/hts_sample.csv")).text());
  rates = await Promise.all(sample.map(async (r) => {
    try { const [bps] = await oracle.getRate(ROUTE, r.hts); return { ...r, bps: Number(bps) }; }
    catch { return { ...r, bps: null }; }
  }));
  $("rates").innerHTML = rates.map((r) =>
    `<tr><td>${esc(r.hts)}</td><td>${r.bps === null ? "n/a" : (r.bps / 100) + "%"}</td><td>${esc(r.desc)}</td></tr>`).join("");
  $("rates").dataset.loaded = String(rates.filter((r) => r.bps !== null).length);
  $("hs").innerHTML = rates.filter((r) => r.bps !== null)
    .map((r) => `<option value="${esc(r.hts)}">${esc(r.hts)} (${r.bps / 100}%) ${esc(r.desc.slice(0, 40))}</option>`).join("");
  $("hs").value = rates.some((r) => r.hts === "9005.80.40") ? "9005.80.40" : $("hs").value;
  quote();
}

function links() {
  const c = dep.contracts, tx = dep.transactions.demoPayTariff;
  const items = [["GitHub repo", REPO], ["SpaceToken on Etherscan", `${SCAN}/address/${c.SpaceToken}`],
    ["TariffOracle on Etherscan", `${SCAN}/address/${c.TariffOracle}`], ["Reserve on Etherscan", `${SCAN}/address/${c.Reserve}`],
    ["TariffRouter on Etherscan", `${SCAN}/address/${c.TariffRouter}`], ["Demo payTariff transaction", `${SCAN}/tx/${tx}`]];
  $("links").innerHTML = items.map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a></li>`).join("");
}

function current() {
  const hs = $("hs").value; const r = rates.find((x) => x.hts === hs);
  let value; try { value = ethers.parseEther(String($("value").value || "0")); } catch { value = 0n; }
  return { hs, r, value };
}

function quote() {
  const { r, value } = current();
  if (!r) { $("quote").textContent = ""; return; }
  const fee = value * BigInt(r.bps) / 10000n, toRes = fee * shareBps / 10000n;
  $("quote").innerHTML = `<div>Fee<b>${fmt(fee)}</b></div><div>To reserve<b>${fmt(toRes)}</b></div><div>To treasury<b>${fmt(fee - toRes)}</b></div>`;
  return { fee };
}

async function connect() {
  if (!window.ethereum) { status("No wallet found. Open this page in a wallet browser (e.g. MetaMask mobile)."); return; }
  const bp = new ethers.BrowserProvider(window.ethereum);
  await bp.send("eth_requestAccounts", []);
  let net = await bp.getNetwork();
  if (net.chainId !== CHAIN_ID) {
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] }); }
    catch { status("Please switch your wallet to Sepolia (chain 11155111)."); return; }
    net = await new ethers.BrowserProvider(window.ethereum).getNetwork();
  }
  if (net.chainId !== CHAIN_ID) { status("Wrong network. Sepolia only."); return; }
  signer = await new ethers.BrowserProvider(window.ethereum).getSigner();
  const addr = await signer.getAddress();
  const bal = await token.balanceOf(addr);
  $("acct").textContent = `Connected ${addr.slice(0, 6)}…${addr.slice(-4)} · ${fmt(bal)} test SPACE`;
  $("approve").disabled = $("pay").disabled = false;
  window.ethereum.on?.("chainChanged", () => location.reload());
}

async function guard() {
  const net = await signer.provider.getNetwork();
  if (net.chainId !== CHAIN_ID) throw new Error("Wrong network. Sepolia only.");
}

function status(m) { $("status").textContent = m; }

async function approve() {
  try {
    await guard(); const q = quote();
    const tx = await token.connect(signer).approve(dep.contracts.TariffRouter, q.fee);
    status("Approve sent… " + tx.hash); await tx.wait(); status("Approved exactly the quoted fee.");
  } catch (e) { status(e.shortMessage || e.message); }
}

async function pay() {
  try {
    await guard(); const { hs, value } = current(); const q = quote();
    const id = ethers.hexlify(ethers.randomBytes(32));
    const tx = await router.connect(signer).payTariff(id, ROUTE, hs, value, q.fee);
    status("payTariff sent… " + tx.hash); await tx.wait();
    $("status").innerHTML = `Paid. <a href="${SCAN}/tx/${tx.hash}" target="_blank" rel="noopener noreferrer">View on Etherscan</a>`;
  } catch (e) { status(e.shortMessage || e.message); }
}

$("hs").addEventListener("change", quote);
$("value").addEventListener("input", quote);
$("connect").addEventListener("click", () => connect().catch((e) => status(e.shortMessage || e.message)));
$("approve").addEventListener("click", approve);
$("pay").addEventListener("click", pay);
init().catch((e) => { $("rates").innerHTML = `<tr><td colspan="3">Could not load: ${esc(e.message)}</td></tr>`; });

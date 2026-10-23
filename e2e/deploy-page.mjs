import puppeteer from "puppeteer-core";
const RPC = process.env.SHIM_RPC, ACCT = process.env.SHIM_ACCT, URL = process.env.PAGE;
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const CB = Boolean(process.env.COINBASE);   // mimic Coinbase Wallet quirks
const SW = Boolean(process.env.SMART);      // mimic a Coinbase Smart Wallet (ERC-4337 account)
await p.evaluateOnNewDocument((rpc, acct, cb, sw) => {
  let id = 0; const calls = [];
  window.__calls = calls;
  window.ethereum = {
    isShim: true,
    async request({ method, params }) {
      calls.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [cb ? acct.toLowerCase() : acct];
      // Smart wallet: account has proxy code; creation txs (no/empty `to`) are impossible;
      // the returned reference is a UserOp hash, not an L1 tx hash (no receipt for it).
      if (sw && method === "eth_getCode" && params[0].toLowerCase() === acct.toLowerCase())
        return "0x363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3";
      if (sw && method === "eth_sendTransaction") {
        const tx = params[0]; window.__sent = (window.__sent || []).concat([tx]);
        if (!tx.to) { const e = new Error("invalid address: null"); e.code = -32602; throw e; }
        if (!window.__ops) window.__ops = 0;
        window.__ops++;
        const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value }] }) });
        const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
        // fake UserOp hash (keccak-looking, never an L1 tx hash)
        return "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      }
      if (cb && method === "eth_sendTransaction") {
        const tx = params[0]; window.__sent = (window.__sent || []).concat([tx]);
        if ("to" in tx && (tx.to === null || tx.to === "" || tx.to === undefined)) { const e = new Error("invalid address"); e.code = -32602; throw e; }
        if (!tx.from || !/^0x[0-9a-fA-F]{40}$/.test(tx.from)) { const e = new Error("invalid address"); e.code = -32602; throw e; }
      }
      if (method === "wallet_switchEthereumChain") return null;
      const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) });
      const j = await r.json();
      // Coinbase-style: report contract-creation txs/receipts with to: "" instead of null.
      if (cb && j.result && (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") && j.result.to == null) j.result.to = "";
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j.result;
    },
    on() {}, removeListener() {},
  };
}, RPC, ACCT, CB, SW);
await p.goto(URL, { waitUntil: "networkidle0" });
await p.click("#connect");
await p.waitForFunction(() => document.getElementById("who").textContent.length > 0, { timeout: 30000 });
console.log("WHO:", await p.$eval("#who", (e) => e.textContent));
let failed = false;
if (process.env.EXPECT_REJECT) { console.log("buttons:", await p.$$eval("#steps button:not([disabled])", (b) => b.length)); await b.close(); process.exit(0); }
await new Promise(r=>setTimeout(r,1500)); console.log("GAS:", await p.$eval("#gas", (e) => e.textContent));
// sending before ack must be impossible
console.log("enabled before ack:", await p.$$eval("#steps button:not([disabled])", (b) => b.length));
await p.click("#ack");
for (let n = 0; n < 9; n++) {
  const btn = await p.waitForSelector("#steps button[data-i]:not([disabled])", { timeout: 60000 });
  const i = await btn.evaluate((e) => e.dataset.i);
  await p.waitForFunction((i) => { const s = document.querySelectorAll(".step")[i]; return s.querySelector('[id^="est-"]').textContent.length > 0; }, {}, Number(i));
  const est = await p.evaluate((i) => document.querySelectorAll(".step")[i].querySelector('[id^="est-"]').textContent, Number(i));
  await p.evaluate((i) => document.querySelector(`#steps button[data-i="${i}"]`).click(), i);
  await p.waitForFunction((i) => { const s = document.querySelectorAll(".step")[i]; return s.classList.contains("done") || s.classList.contains("err"); }, { timeout: 60000 }, Number(i));
  const t = await p.evaluate((i) => { const s = document.querySelectorAll(".step")[i]; return [s.classList.contains("done"), s.querySelector("h3").textContent, s.querySelector('[id^="msg-"]').textContent]; }, Number(i));
  console.log(`STEP ${t[1]} done=${t[0]}\n   est: ${est}\n   ${t[2]}`);
  if (!t[0]) { failed = true; break; }
}
if (failed) { await b.close(); process.exit(1); }
if (CB || SW) console.log("SENT KEYS:", JSON.stringify(await p.evaluate(() => window.__sent.map((t) => Object.keys(t).join(",")))));
await p.waitForFunction(() => !document.getElementById("result").hidden && /✓|✗/.test(document.getElementById("roles")?.textContent || ""), { timeout: 30000 });
console.log("ROLES:", await p.$eval("#roles", (e) => e.textContent));
console.log("JSON:", await p.$eval("#json", (e) => e.value));
await p.screenshot({ path: "/tmp/e2e/deploy-mobile.png", fullPage: true });
await b.close();

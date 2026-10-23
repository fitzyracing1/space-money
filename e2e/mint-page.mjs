// Mint page E2E with a Coinbase Smart Wallet shim (proxy code, no-`to` rejected, UserOp-style hash, no receipt).
import puppeteer from "puppeteer-core";
const RPC = process.env.SHIM_RPC, ACCT = process.env.SHIM_ACCT, URL = process.env.PAGE;
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.evaluateOnNewDocument((rpc, acct) => {
  let id = 0; window.__sent = [];
  const call = async (method, params) => { const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }) }); const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j.result; };
  window.ethereum = { async request({ method, params }) {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct.toLowerCase()];
    if (method === "eth_sendTransaction") {
      const tx = params[0]; window.__sent.push(Object.keys(tx).join(","));
      if (!tx.to) { const e = new Error("invalid address: null"); e.code = -32602; throw e; }
      await call(method, [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value }]);
      return "0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) => x.toString(16).padStart(2, "0")).join("");
    }
    if (method === "eth_getTransactionReceipt") return null;   // UserOp hash: never a receipt
    return call(method, params);
  }, on() {} };
}, RPC, ACCT);
await p.goto(URL, { waitUntil: "networkidle0" });
await p.click("#connect");
await p.waitForSelector("#bal", { timeout: 30000 });
console.log("WHO:", await p.$eval("#who", (e) => e.innerText.replace(/\n/g, " | ")));
console.log("BEFORE:", await p.$eval("#supply", (e) => e.innerText.replace(/\n/g, " | ")));
console.log("recipient default:", await p.$eval("#to", (e) => e.value), "amount:", await p.$eval("#amount", (e) => e.value));
console.log("mint enabled before tick:", await p.$eval("#mint", (e) => !e.disabled));
// other recipient -> warning
await p.evaluate(() => { const t = document.getElementById("to"); t.dataset.orig = t.value; t.value = "0x000000000000000000000000000000000000dEaD"; t.dispatchEvent(new Event("input")); });
console.log("warning shown for other recipient:", await p.$eval("#towarn", (e) => !e.hidden));
await p.evaluate(() => { const t = document.getElementById("to"); t.value = t.dataset.orig; t.dispatchEvent(new Event("input")); });
console.log("warning hidden for self:", await p.$eval("#towarn", (e) => e.hidden));
await p.evaluate(() => { const a = document.getElementById("ack"); a.checked = true; a.dispatchEvent(new Event("change")); });
await p.waitForFunction(() => /Gas ≈/.test(document.getElementById("est").textContent), { timeout: 30000 });
console.log("EST:", await p.$eval("#est", (e) => e.textContent));
await p.evaluate(() => document.getElementById("mint").click());
await p.waitForFunction(() => /✓ Minted|Error/.test(document.getElementById("msg").textContent), { timeout: 120000 });
console.log("MSG:", await p.$eval("#msg", (e) => e.textContent));
console.log("AFTER:", await p.$eval("#supply", (e) => e.innerText.replace(/\n/g, " | ")));
console.log("SENT KEYS:", JSON.stringify(await p.evaluate(() => window.__sent)));
await p.screenshot({ path: "/tmp/e2e/mint-mobile.png", fullPage: true });
await b.close();

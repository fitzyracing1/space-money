import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const [page, mode] of [["index.html","added"],["deploy.html","declined"],["mint.html","unsupported"],["mint.html","none"]]) {
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true });
  await p.evaluateOnNewDocument((mode) => {
    if (mode === "none") return;
    let chain = "0x2105"; window.__log = [];
    window.ethereum = { on() {}, async request({ method, params }) { window.__log.push(method);
      if (method === "eth_requestAccounts" || method === "eth_accounts") return ["0x20ffd7c153b68002ef052614a5600e240e7e2474"];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") { chain = params[0].chainId; return null; }
      if (method === "wallet_watchAsset") { window.__wa = { params, chain };
        if (mode === "added") return true; if (mode === "declined") { const e = new Error("User rejected"); e.code = 4001; throw e; }
        const e = new Error("Method not supported"); e.code = -32601; throw e; }
      throw new Error("unexpected " + method); } };
  }, mode);
  await p.goto("http://127.0.0.1:8088/" + page, { waitUntil: "networkidle0" });
  const top = await p.$eval("#watchBtn", (e) => Math.round(e.getBoundingClientRect().top));
  await p.evaluate(() => document.getElementById("watchBtn").click());
  await p.waitForFunction(() => /✓|⚠️|❌/.test(document.getElementById("watchMsg").textContent), { timeout: 10000 });
  console.log(page, mode, "btnTop=" + top, "|", (await p.$eval("#watchMsg", (e) => e.innerText)).replace(/\n/g, " / "), "| copyBtn:", !!(await p.$("#watchCopy")),
    "| wa:", JSON.stringify(await p.evaluate(() => window.__wa || null)));
  if (page === "mint.html" && mode === "unsupported") await p.screenshot({ path: "/tmp/e2e/watch.png" });
  await p.close();
}
await b.close();

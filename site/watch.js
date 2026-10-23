// Shared "Add SPACE to my wallet" button (EIP-747 wallet_watchAsset). No data collected.
const TOKEN = { address: "0x0af05969C412Dc1E07be5fC5A4e141214aAe846e", symbol: "SPACE", decimals: 18,
  image: "https://fitzyracing1.github.io/space-money/space-logo.png" };
const box = document.getElementById("addtoken");
if (box) {
  box.innerHTML = `<button id="watchBtn" class="watch"><img src="space-logo.png?v=5" alt="" width="22" height="22"> Add SPACE to my wallet</button>
    <div class="kv" id="watchMsg"></div>`;
  const msg = document.getElementById("watchMsg");
  const fallback = (why) => {
    msg.innerHTML = `${why}<br>Add it manually (Ethereum network, custom token):<br><code id="watchAddr">${TOKEN.address}</code>
      <button id="watchCopy" class="copy">Copy address</button><br>Symbol SPACE · Decimals 18`;
    document.getElementById("watchCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(TOKEN.address); } catch { const r = document.createRange(); r.selectNode(document.getElementById("watchAddr")); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand("copy"); }
      document.getElementById("watchCopy").textContent = "Copied ✓";
    };
  };
  document.getElementById("watchBtn").onclick = async () => {
    const eth = window.ethereum;
    if (!eth) return fallback("❌ Unsupported: no wallet in this browser. Open the page in the Coinbase / Base wallet app.");
    msg.textContent = "Switching to Ethereum mainnet…";
    try {
      await eth.request({ method: "eth_requestAccounts" });
      if ((await eth.request({ method: "eth_chainId" })) !== "0x1") await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
      if ((await eth.request({ method: "eth_chainId" })) !== "0x1") return fallback("❌ Couldn't switch to Ethereum mainnet.");
    } catch (e) { return fallback(`❌ Couldn't switch to Ethereum mainnet (${e?.code ?? ""} ${e?.message ?? e}).`); }
    msg.textContent = "Confirm in your wallet…";
    try {
      const ok = await eth.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: TOKEN } });
      if (ok === false) fallback("⚠️ Declined: the wallet didn't add SPACE.");
      else msg.textContent = "✓ Added: SPACE should now appear in your wallet on Ethereum.";
    } catch (e) {
      if (e?.code === 4001) fallback("⚠️ Declined in the wallet.");
      else if (e?.code === -32601 || e?.code === 4200 || /not supported|unsupported|does not exist/i.test(e?.message || "")) fallback("❌ Unsupported: this wallet can't add tokens automatically.");
      else fallback(`❌ Failed: ${e?.code ?? ""} ${e?.message ?? e}`);
    }
  };
}

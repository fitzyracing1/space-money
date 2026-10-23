# Deploy-page end-to-end test (local only, no real funds)

Drives `site/deploy.html` in headless Chrome at phone size. An injected `window.ethereum` shim forwards every call to a local **anvil fork of mainnet** (chain id 1), using anvil's unlocked dev accounts, so the page's real chain-1 code path runs without spending real ETH.

```bash
anvil --fork-url https://ethereum-rpc.publicnode.com --chain-id 1 --port 8546 &
mkdir -p /tmp/_site/{deployments,data} && cp -r site/* /tmp/_site/ && cp deployments/sepolia.json /tmp/_site/deployments/ && cp data/hts_sample.csv /tmp/_site/data/
(cd /tmp/_site && python3 -m http.server 8088 &)
npm i puppeteer-core@23
SHIM_RPC=http://127.0.0.1:8546 SHIM_ACCT=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 PAGE=http://127.0.0.1:8088/deploy.html node e2e/deploy-page.mjs
# wrong-chain check: point SHIM_RPC at an anvil with --chain-id 11155111 and set EXPECT_REJECT=1
```

## Coinbase Wallet mode

`COINBASE=1` makes the shim mimic Coinbase / Base wallet quirks: `eth_accounts` returns a lowercase address,
`eth_sendTransaction` rejects any tx whose `to` key is present but null/empty (`invalid address`, code -32602),
and contract-creation txs/receipts come back with `to: ""`. The pre-fix page failed step 1 with
`invalid value for value.to (invalid address …)` under this shim; the fixed page completes all 9 steps.

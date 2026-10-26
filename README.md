# space-money

> ⚠️ **Prototype — TESTNET/LOCAL ONLY.** Not audited. Not deployed to mainnet. No real funds.

**SPACE** is a prototype ERC-20 used to pay cross-border (and, notionally, space-cargo) tariffs.

| Contract | Role |
|---|---|
| `SpaceToken` | OpenZeppelin ERC-20 (`SPACE`, 18 decimals), `MINTER_ROLE`-gated mint |
| `TariffOracle` | Ad-valorem tariff rates in basis points keyed by `(route, HS code)`, written only by `UPDATER_ROLE` |
| `TariffRouter` | `payTariff(shipmentId, route, hsCode, declaredValue, maxFee)`: fee = value × rate; `reserveShareBps` (default 20%, configurable by `CONFIG_ROLE`) → `Reserve`, rest → treasury. Replay-protected per shipment, `maxFee` slippage guard |
| `Reserve` | Holds the reserve share of fees; `WITHDRAWER_ROLE`-gated withdrawals |

## What backs SPACE (read this)
**The tariff data is not the backing. The fees and the reserve are.** The oracle only says how much is owed. Whatever value SPACE has in this design comes from the fees that are actually paid and the share of them held in the `Reserve` contract. Publishing tariff rates on-chain creates no value by itself.

## Quick start
```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
git clone --recursive https://github.com/fitzyracing1/space-money && cd space-money
forge test          # 42 tests: fees, reserve split, access control, edge cases, fuzz, mainnet-deploy guards
./scripts/demo.sh   # anvil → deploy → feed real HTS rates → pay a tariff → show the split
```

Example demo output:
```
fed 25 HTS rates for route ANY->US into oracle 0xe7f1...0512
  9005.80.40         8% -> 800 bps  Optical telescopes
== quote: optical telescopes HTS 9005.80.40, declared value 50000 SPACE ==
== after payTariff ==
shipper  SPACE: 96000
reserve  SPACE: 800
treasury SPACE: 3200
```

## Tariff data source
`scripts/feed_oracle.py` loads `data/hts_sample.csv` into the oracle with one `setRates` batch. The sample is from the **U.S. International Trade Commission (USITC) Harmonized Tariff Schedule of the United States**, through its public REST API (`https://hts.usitc.gov/reststop/search?keyword=…`), using keywords telescope, satellite, rocket, solar cells, gyroscope, lithium batteries and spacecraft. Only the "General" (MFN) column is used, and only rows that are `Free` or a plain ad-valorem `%` (specific/compound duties are skipped). The snapshot was taken on 2026-10-22; `--refresh` pulls it again. The data is for demonstration and is not customs advice.

## Sepolia testnet deployment
Deployed on **Sepolia testnet only** (chain id 11155111) on 2026-10-22. Test tokens only, no real value. Contracts are not verified on Etherscan. Full record: [`deployments/sepolia.json`](deployments/sepolia.json).

| Contract | Address |
|---|---|
| SpaceToken (SPACE) | [`0x80Ce8Ec02eFE1E3436A6865a44f1Fa9E5B04589E`](https://sepolia.etherscan.io/address/0x80Ce8Ec02eFE1E3436A6865a44f1Fa9E5B04589E) |
| TariffOracle | [`0x122028d60f6606b9d15B2913fFFa27F9afcD2Eac`](https://sepolia.etherscan.io/address/0x122028d60f6606b9d15B2913fFFa27F9afcD2Eac) |
| Reserve | [`0xa41FdDE870f338B856df637aD581216D8659aD8D`](https://sepolia.etherscan.io/address/0xa41FdDE870f338B856df637aD581216D8659aD8D) |
| TariffRouter | [`0x05Dbc5Bca975B2da76A5A421824629977d3770E4`](https://sepolia.etherscan.io/address/0x05Dbc5Bca975B2da76A5A421824629977d3770E4) |

Treasury = deployer `0x31e4A02C0835d9e27D68528e89411a1B1A256D19`, reserve share 20%. The oracle was loaded with the 25 USITC HTS rates for route `ANY->US`. Demo [`payTariff`](https://sepolia.etherscan.io/tx/0xedeeaea10a7e73632a97d2bef572c43eee57dd1971609d0c84b6149577ff3a46): optical telescopes (HTS 9005.80.40, 8%), declared value 50,000 SPACE → fee 4,000 SPACE → **800 to Reserve**, 3,200 to treasury.

Note: Sepolia charges far more gas for contract creation than forge's local simulation predicts, so deploy with `--skip-simulation` to let the node estimate gas.

## Deploying to Sepolia yourself
You need:
1. A dedicated testnet-only deployer key, exported as an env var (e.g. `PRIVATE_KEY`), never committed.
2. Sepolia ETH for gas from a faucet.
3. A Sepolia RPC URL (`SEPOLIA_RPC_URL`, from Alchemy, Infura or a public endpoint).
4. Optionally an `ETHERSCAN_API_KEY` for `--verify`.
5. `TREASURY=<addr> forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --slow --skip-simulation --verify`, then `ORACLE=<addr> RPC_URL=$SEPOLIA_RPC_URL python3 scripts/feed_oracle.py`.
6. Ideally, admin roles handed to a Safe multisig after deploy.

`Deploy.s.sol` refuses to run on chain id 1.

## Live demo site
https://fitzyracing1.github.io/space-money/ is a static page in `site/` (ethers v6 from a CDN, no build step), published by `.github/workflows/pages.yml`. It reads the Sepolia contracts live. It has a quote calculator and Sepolia-only approve/payTariff, and it collects no data. [`deploy.html`](https://fitzyracing1.github.io/space-money/deploy.html) is a phone-friendly, chain-1-only page for deploying from a wallet (see MAINNET.md). It is tested via `e2e/`.

## Mainnet deployment

> **Prototype only.** Unaudited, not an offering, no real value. The tariff data is not the backing. Do not sell, distribute or list SPACE before legal review (see the Legal note below).

Deployed on 2026-10-23 from a Coinbase Smart Wallet via the deterministic CREATE2 deployer (`0x4e59b448…956C`, salt version `space-money/v1`). Admin, treasury, minter and oracle updater: [`0x20fFd7C1…2474`](https://etherscan.io/address/0x20fFd7C153B68002EF052614a5600E240E7E2474). Reserve share 20%; 25 HTS rates fed. Full record: [`deployments/mainnet.json`](deployments/mainnet.json).

| Contract | Address |
|---|---|
| SpaceToken (SPACE) | [0x0af05969C412Dc1E07be5fC5A4e141214aAe846e](https://etherscan.io/address/0x0af05969C412Dc1E07be5fC5A4e141214aAe846e) |
| TariffOracle | [0x05D05690425C79a9367c3Ac626F67D148e53Bc6a](https://etherscan.io/address/0x05D05690425C79a9367c3Ac626F67D148e53Bc6a) |
| Reserve | [0x9D8E61007980d6Cb0ec0E8E4D3adA1F12D791A8D](https://etherscan.io/address/0x9D8E61007980d6Cb0ec0E8E4D3adA1F12D791A8D) |
| TariffRouter | [0x0A156a7652f809D6F07a0fCB2D85a8F88b038ABd](https://etherscan.io/address/0x0A156a7652f809D6F07a0fCB2D85a8F88b038ABd) |

Source verified on [Sourcify](https://repo.sourcify.dev/1/0x0af05969C412Dc1E07be5fC5A4e141214aAe846e) (status `match` for runtime and creation bytecode on all four; not `exact_match` because the build omits CBOR metadata for reproducibility). Minting from the admin wallet: [`mint.html`](https://fitzyracing1.github.io/space-money/mint.html).


## Use the tariff feed

The mainnet TariffOracle is a public tariff data feed that any coin, contract or app can read for free.

- **Live rates:** [feed.html](https://fitzyracing1.github.io/space-money/feed.html), read straight from chain.
- **Oracle:** [`0x05D05690425C79a9367c3Ac626F67D148e53Bc6a`](https://etherscan.io/address/0x05D05690425C79a9367c3Ac626F67D148e53Bc6a#readContract): `getRate("ANY->US", "<HTS code>") → (bps, updatedAt)`.
- **Standard:** [docs/TFS-1.md](docs/TFS-1.md), the draft *Tariff Feed Standard* (`ITariffFeed`, ERC-165 id `0x89f00515`). It covers batch reads, source ids, staleness guidance and versioning.
- **Integration guide:** [docs/integrate.md](docs/integrate.md), with Solidity, ethers.js and cast snippets.
- **Adapter:** the live oracle predates TFS-1. [`TariffFeedAdapter`](src/TariffFeedAdapter.sol) wraps it read-only so it conforms, without redeploying the oracle. It is not deployed yet. The admin can deploy it from feed.html through the CREATE2 factory; its predicted address is `0x42BbE6c607a95a245ace68f49cF589D67864a548`.
- **Example consumer:** [`TariffFeeCalculator`](src/examples/TariffFeeCalculator.sol) quotes duty in stablecoin units and rejects stale, future-dated or unknown rates.
- **Updating rates:** `python3 scripts/update_feed.py` diffs live USITC HTS against chain and prints only the changes, as an unsigned `setRates` tx (`--format calldata` gives raw calldata, `--all` gives a re-attestation batch). It never signs. The updater wallet reviews the output and sends it.

Rates are informational, not legal or customs advice.

## Mainnet
Not deployed. See [MAINNET.md](MAINNET.md) for the legal, audit, cost, Safe and updater-key checklist and the guarded `script/DeployMainnet.s.sol`.

## Legal note
This repository is a **technical prototype, not an offering**. Nothing here is an offer or solicitation to sell any token, security or financial product, and SPACE has no value. No token sale is planned or authorized. **Consult a qualified lawyer before any sale, distribution or public deployment** of a token like this. Securities, money-transmission, sanctions and customs law may all apply.

## License
MIT © 2026 Joshua Almeida

## Full US tariff schedule (HTS)

- `data/hts/`: the full **2026 HTS Revision 21** (USITC). It holds 23,696 lines with parsed General rates (ad valorem, specific, compound, free) and Special programs. A separate Chapter 99 layer covers Section 301 (China) and Section 232 (steel, aluminum, copper). See [docs/hts-coverage.md](docs/hts-coverage.md) for what is and is not covered (no AD/CVD).
- [docs/TFS-1a.md](docs/TFS-1a.md): a backward-compatible extension for specific and compound rates. The reference `src/TariffFeedV2.sol` is not deployed.
- [docs/gas-plan.md](docs/gas-plan.md): a cost comparison. It recommends one Merkle root per revision on mainnet (`scripts/hts_merkle.py`).
- Search the full schedule in the browser on the [feed page](https://fitzyracing1.github.io/space-money/feed.html).

## Plans

This project is free, and its license stays as is. Support it through [GitHub Sponsors](https://github.com/sponsors/fitzyracing1):

- **Free**: use the code, community support.
- **Pro ($49/month)**: priority issues and support.
- **Team ($199/month)**: priority support for your team plus early access.

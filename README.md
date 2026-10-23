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
forge test          # 36 tests: fees, reserve split, access control, edge cases, fuzz
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

## Deploying to Sepolia (not done)
No deployer key exists for this repo, and none was created. A Sepolia deploy would need:
1. A dedicated testnet-only deployer key, exported as an env var (e.g. `PRIVATE_KEY`), never committed.
2. Sepolia ETH for gas from a faucet.
3. A Sepolia RPC URL (`SEPOLIA_RPC_URL`, from Alchemy, Infura or a public endpoint).
4. Optionally an `ETHERSCAN_API_KEY` for `--verify`.
5. `TREASURY=<addr> forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify`, then `ORACLE=<addr> RPC_URL=$SEPOLIA_RPC_URL python3 scripts/feed_oracle.py`.
6. Ideally, admin roles handed to a Safe multisig after deploy.

`Deploy.s.sol` refuses to run on chain id 1.

## Legal note
This repository is a **technical prototype, not an offering**. Nothing here is an offer or solicitation to sell any token, security or financial product, and SPACE has no value. No token sale is planned or authorized. **Consult a qualified lawyer before any sale, distribution or public deployment** of a token like this. Securities, money-transmission, sanctions and customs law may all apply.

## License
MIT © 2026 Joshua Almeida

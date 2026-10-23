# Gas plan: publishing the full HTS on-chain

Dataset: 47,574 leaves (23,405 base lines with a rate plus 24,169 Chapter 99 entries). Gas figures were measured with `forge test` on `TariffFeedV2` (`test_gasBatch100`, `test_merkleVectorsFromPython`):

| Operation | Gas |
|---|---:|
| `setRatesV2`, per new rate (storage write + 2 events) | ≈65,300 execution, **≈70,000** with calldata |
| `publishRoot` (one per HTS revision) | 172,292 execution, ≈196,000 total |
| `proveRate` (verify a 16-deep proof + materialize) | 106,436 execution, ≈137,000 total |
| `verifyRate` (view) | free off-chain, ≈30k inside another call |

Prices were read on **2026-10-23 at about 02:30 EDT**: mainnet 0.0595 gwei, Base 0.006 gwei, OP 0.001 gwei, Arbitrum 0.02 gwei. ETH was $2,401 (CoinGecko). L1 data fees were taken from each chain's fee oracle for a 450-byte rate.

| Design | Chain | One-time cost | Per revision |
|---|---|---:|---|
| Store every rate (47,574 × 70k gas ≈ 3.33 B gas, ~93 full 36M-gas blocks) | Ethereum @ 0.06 gwei (today) | 0.198 ETH ≈ **$476** | changed lines only |
| | Ethereum @ 1 gwei | 3.33 ETH ≈ **$7,997** | |
| | Ethereum @ 10 gwei | 33.3 ETH ≈ **$79,970** | |
| | Base | ≈0.020 ETH ≈ **$48** | |
| | OP Mainnet | ≈0.0035 ETH ≈ **$8.40** | |
| | Arbitrum One | ≈0.068 ETH ≈ **$162** | |
| **Merkle root** | Ethereum | ≈196k gas ≈ **$0.03** (0.06 gwei) / $0.47 (1 gwei) / $4.71 (10 gwei) | the same, once per revision |
| Materialize one rate on demand (`proveRate`) | Ethereum | ≈137k gas ≈ $0.02 / $0.33 at 1 gwei, paid by whoever needs it | |

## Recommendation

**Publish one Merkle root per HTS revision on Ethereum mainnet** (in `TariffFeedV2`), keep the full dataset in `data/hts/`, and verify rates or materialize them on demand.

- The cost is constant (cents to a few dollars per revision) and does not depend on gas spikes or schedule size.
- Anyone can check any of the 47.6k rates for free with `verifyRate`, or pay about 137k gas once to make a rate readable through plain TFS-1/TFS-1a. Materialized rates carry the root's publish time, so staleness checks stay honest.
- It stays on the same chain as the live `TariffOracle`. The 25 hot rates keep working unchanged through the TFS-1 adapter.
- Full per-rate storage on mainnet is affordable only at today's unusually low gas. At ordinary prices (1–10 gwei) it costs $8k–$80k, plus about 1,000+ changed lines per revision. If contracts need proof-free reads of everything, mirror the full table on **OP Mainnet or Base** ($8–$50 one-time) and keep the root on mainnet as the anchor.

Tooling:
- `python3 scripts/hts_merkle.py` builds `data/hts/merkle/root.json`. This includes unsigned `publishRootCalldata` for a future FeedV2.
- `--proof "<route>" <code>` prints a proof.
- CI checks that the root is reproducible.

Nothing has been deployed or sent.

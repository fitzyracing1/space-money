# TFS-1: Tariff Feed Standard (draft)

| | |
|---|---|
| Status | Draft, v1 |
| Interface | [`src/interfaces/ITariffFeed.sol`](../src/interfaces/ITariffFeed.sol) |
| ERC-165 id | `0x89f00515` |
| Reference adapter | [`src/TariffFeedAdapter.sol`](../src/TariffFeedAdapter.sol) |
| Example consumer | [`src/examples/TariffFeeCalculator.sol`](../src/examples/TariffFeeCalculator.sol) |

TFS-1 is a small read interface for import-tariff rates published on-chain, so that any token, escrow,
payment app or wallet can read duty rates the same way, whoever publishes them.

> Rates are informational. They are not legal or customs advice, and a feed is only as good as its publisher.

## Data model

A rate is keyed by **route** and **HS code**:

- `route`: a string `"<ORIGIN>-><DEST>"` using ISO 3166-1 alpha-2 codes, or `ANY` for a column that applies to
  every origin (for example US MFN "General" rates are `ANY->US`). Publishers MUST document their routes.
- `hsCode`: the HS / national tariff code exactly as the source writes it, with dots
  (for example `9005.80.40` or `9013.90.20.00`). Consumers MUST NOT normalise it; look up the exact string.
- `key = keccak256(abi.encode(route, hsCode))`.
- `bps`: ad-valorem rate in basis points, `0..10_000` (1 bps = 0.01%). Specific or compound duties
  (for example "$1.20/kg") are out of scope for TFS-1 and MUST NOT be published as bps.
- `lastUpdated`: unix seconds of the block in which the value was last written.
- `sourceId`: `bytes32` naming the data source, a left-aligned ASCII string, for example `bytes32("USITC-HTS")`.

## Interface

```solidity
interface ITariffFeed is IERC165 {
    struct TariffRate { uint16 bps; uint64 lastUpdated; bytes32 sourceId; bool exists; }

    event TariffRateUpdated(bytes32 indexed key, string route, string hsCode,
                            uint16 bps, uint64 lastUpdated, bytes32 indexed sourceId);
    error TariffRateNotFound(bytes32 key);

    function tariffKey(string calldata route, string calldata hsCode) external pure returns (bytes32);
    function tariffRate(string calldata route, string calldata hsCode)
        external view returns (uint16 bps, uint64 lastUpdated, bytes32 sourceId);
    function tariffRates(string[] calldata routes, string[] calldata hsCodes)
        external view returns (TariffRate[] memory);
    function tfsVersion() external pure returns (uint16);   // 1
}
```

Rules:

1. **Single read.** `tariffRate` MUST revert with `TariffRateNotFound(key)` when the pair is not published.
   It MUST NOT return `0` for unknown pairs, because `0` is a real rate ("Free").
2. **Batch read.** `tariffRates` MUST NOT revert for unknown pairs. It returns `exists = false` with zeroed
   fields. It MUST revert if the arrays have different lengths.
3. **Update event.** A native implementation MUST emit `TariffRateUpdated` on every write, including writes
   that leave the value unchanged (a re-attestation). An adapter over a legacy feed MAY omit it and MUST
   document which source event to watch instead.
4. **ERC-165.** `supportsInterface(0x89f00515)` and `supportsInterface(0x01ffc9a7)` MUST return true.
   Consumers SHOULD check this before trusting a feed address.
5. **Read-only.** TFS-1 doesn't define how rates are written or who may write them. Publishers SHOULD use
   role-based access and document their updater.

## Staleness guidance

`lastUpdated` is when the on-chain value was last written. Tariff schedules change rarely but unpredictably:
the US HTS has a basic edition each January and several revisions a year, and special tariffs can change
with little notice.

- Consumers MUST pick a `maxAge` that fits their risk, and reject rates where
  `block.timestamp - lastUpdated > maxAge`. They MUST also reject `lastUpdated > block.timestamp`.
  `TariffFeeCalculator` shows the pattern.
- Suggested defaults: **400 days** for informational MFN quotes (one HTS edition plus margin), **30 days** or less
  where money settles automatically against the rate (escrow, fee collection), and **7 days** around known
  tariff actions.
- Publishers that use a short `maxAge` SHOULD re-attest unchanged rates (write the same value again) on a
  regular schedule, so `lastUpdated` reflects "last checked" and not only "last changed". In this repo,
  `scripts/update_feed.py --all` produces a re-attestation batch.
- A rate of `0` with a fresh `lastUpdated` means duty-free. A missing rate means unknown; never treat it as 0.
- `feed.html` marks rates **lit** when they're within 400 days and **dark** when they're older.

## Versioning

- The version is identified by the ERC-165 id **and** `tfsVersion()`. TFS-1 is `0x89f00515` / `1`.
- Any change to function signatures, or to the meaning of an existing field, is a new version (TFS-2) with a
  new interface id. A contract MAY support several versions at once by answering `true` for each id.
- Backward-compatible clarifications to this document (wording, new suggested `sourceId`s, new route
  conventions) do not change the version. They're tracked in the changelog below.
- Consumers SHOULD require the exact interface id they were written against, not `tfsVersion() >= n`.

## Deployments

| Network | Contract | Address | TFS-1 |
|---|---|---|---|
| Ethereum mainnet | TariffOracle (source, live) | [`0x05D05690425C79a9367c3Ac626F67D148e53Bc6a`](https://etherscan.io/address/0x05D05690425C79a9367c3Ac626F67D148e53Bc6a) | No: legacy `getRate(route, hsCode) → (bps, updatedAt)` |
| Ethereum mainnet | TariffFeedAdapter (planned, not deployed) | `0x42BbE6c607a95a245ace68f49cF589D67864a548` (CREATE2, predicted) | Yes |

The live oracle only partly meets TFS-1. It has a per-pair read with a timestamp, a revert when a pair is
unset, and ERC-165 for AccessControl. It has no `sourceId`, no batch read, no TFS-1 interface id, and its
event is `RateSet(key, route, hsCode, bps)`. `TariffFeedAdapter` wraps it read-only (no owner, no storage)
with `sourceId = bytes32("USITC-HTS")`, so the oracle doesn't need redeploying. The admin can deploy the
adapter from [feed.html](https://fitzyracing1.github.io/space-money/feed.html) through the CREATE2 factory,
and the address above is deterministic.

## Changelog

- 2026-10-23: draft v1.

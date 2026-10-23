# TFS-1a: specific and compound duty rates (draft extension to TFS-1)

TFS-1 only describes ad-valorem rates in basis points. That covers most of the US schedule, but not all of it. In HTS 2026 Rev 21, 1,567 lines are **specific** (e.g. `1¢/kg`), 481 are **compound** (e.g. `$1.104/kg + 14.9%`) and 622 are **text-only** rates. TFS-1a adds these as an optional extension.

Interface: [`src/interfaces/ITariffFeedSpecific.sol`](../src/interfaces/ITariffFeedSpecific.sol). ERC-165 id is **`0xcaa9e3cb`**. Reference implementation: [`src/TariffFeedV2.sol`](../src/TariffFeedV2.sol), which is **not deployed**.

```solidity
enum RateType { Free, AdValorem, Specific, Compound, Other }
struct TariffRateV2 {
  RateType rateType;
  uint32  bps;          // ad-valorem part; MAY exceed 10_000 (200% = 20_000)
  uint64  amountMicro;  // specific part in 1e-6 currency units per unit (1¢ = 10_000; $1.104 = 1_104_000)
  bytes16 unit;         // "kg", "liter", "each", "doz", "proof liter", ... (left-aligned ASCII)
  bytes3  currency;     // "USD"; zero when there is no specific part
  uint64  lastUpdated;  // when the data was attested (Merkle: root publish time)
  bytes32 sourceId;     // bytes32("USITC-HTS")
  bool    exists;
}
function tariffRateV2(string route, string hsCode) view returns (TariffRateV2);    // reverts TariffRateNotFound
function tariffRatesV2(string[] routes, string[] hsCodes) view returns (TariffRateV2[]); // never reverts for unset
event TariffRateV2Updated(bytes32 indexed key, string route, string hsCode, RateType, uint32 bps,
                          uint64 amountMicro, bytes16 unit, bytes3 currency, uint64 lastUpdated, bytes32 indexed sourceId);
```

## Backward compatibility rules

1. A TFS-1a feed **MUST** also implement TFS-1 and report both ids (`0x89f00515` and `0xcaa9e3cb`) through ERC-165. `tfsVersion()` stays `1`; extensions are discovered via ERC-165.
2. A TFS-1 read **MUST NOT** misrepresent a rate. If the rate is Specific, Compound or Other, or if it is above 10,000 bps:
   - `tariffRate` reverts. FeedV2 uses `TariffRateNotAdValorem(key)`.
   - `tariffRates` returns `exists = false`.

   This way a TFS-1 consumer can never read `5¢/kg` as "0 bps = Free".
3. Free and AdValorem rates up to 10,000 bps emit both `TariffRateUpdated` (TFS-1) and `TariffRateV2Updated`.
4. Field validity: `bps` must be 0 unless the type is AdValorem or Compound. `amountMicro`, `unit` and `currency` must be zero unless the type is Specific or Compound, and are then required. FeedV2 rejects any other shape with `BadRate()`.
5. `Other` means the legal text has no fixed formula (e.g. "the rate applicable to the article of which it is a part"). Consumers must resolve it off-chain.

## Computing a duty (consumer side)

`duty = value * bps / 10_000 + quantity_in_unit * amountMicro / 1e6`. The unit is the HTS unit for the specific part, which can differ from the statistical reporting unit (e.g. "on drained weight" or "on lead content"). Lines like these were parsed as `Other` where the qualifier changes the base.

## Keys for the Chapter 99 layer

Base rates use `route = "ANY->US"` and `hsCode = "<HTS>"`. Additional duties are separate entries with `route = "<ISO2 origin | ANY>->US"` and `hsCode = "<HTS>#<9903 heading>"`, e.g. `("CN->US", "8703.80.00.10#9903.88.03")`. They never overwrite the base rate. Consumers add the layers that apply.

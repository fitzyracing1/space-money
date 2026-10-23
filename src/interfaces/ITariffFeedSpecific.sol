// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title ITariffFeedSpecific: TFS-1a extension for specific and compound duty rates (draft)
/// @notice Optional extension to TFS-1 (ITariffFeed). A TFS-1a feed MUST also implement TFS-1 and report both
///         interface ids via ERC-165. TFS-1 readers keep working: a rate that cannot be expressed as ad-valorem
///         bps (specific, compound, other, or > 10_000 bps) is NOT returned by TFS-1 tariffRate (it reverts) and is
///         reported as exists=false by TFS-1 tariffRates, so legacy consumers never misread "5.1¢/kg" as "Free".
///         See docs/TFS-1a.md.
interface ITariffFeedSpecific is IERC165 {
    /// Free = 0 duty; AdValorem = bps only; Specific = amount per unit only; Compound = bps + amount per unit;
    /// Other = text-only rate (e.g. "the rate applicable to the article of which it is a part"); use the source.
    enum RateType {
        Free,
        AdValorem,
        Specific,
        Compound,
        Other
    }

    struct TariffRateV2 {
        RateType rateType;
        uint32 bps; // ad-valorem part, basis points, MAY exceed 10_000 (e.g. 20_000 = 200%)
        uint64 amountMicro; // specific part, in 1e-6 of `currency` per `unit` (1¢ = 10_000)
        bytes16 unit; // left-aligned ASCII, e.g. bytes16("kg"), bytes16("liter"), bytes16("each")
        bytes3 currency; // ISO 4217, e.g. bytes3("USD"); zero when there is no specific part
        uint64 lastUpdated; // unix seconds the data was attested (for Merkle-proved rates: root publish time)
        bytes32 sourceId;
        bool exists;
    }

    event TariffRateV2Updated(
        bytes32 indexed key,
        string route,
        string hsCode,
        RateType rateType,
        uint32 bps,
        uint64 amountMicro,
        bytes16 unit,
        bytes3 currency,
        uint64 lastUpdated,
        bytes32 indexed sourceId
    );

    /// @notice Full rate. MUST revert with ITariffFeed.TariffRateNotFound(key) if unset.
    function tariffRateV2(string calldata route, string calldata hsCode) external view returns (TariffRateV2 memory);

    /// @notice Batch read; MUST NOT revert for unset pairs.
    function tariffRatesV2(string[] calldata routes, string[] calldata hsCodes)
        external
        view
        returns (TariffRateV2[] memory);
}

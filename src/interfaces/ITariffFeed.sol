// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title ITariffFeed: Tariff Feed Standard, TFS-1 (draft)
/// @notice Read-only interface for on-chain import-tariff rates keyed by (route, HS code).
///         Rates are ad-valorem basis points (1 bps = 0.01%, 10_000 = 100%). See docs/TFS-1.md.
/// @dev ERC-165 id = type(ITariffFeed).interfaceId (excludes the inherited supportsInterface).
interface ITariffFeed is IERC165 {
    /// @notice One rate entry. `exists == false` means the pair is not published (other fields are zero).
    struct TariffRate {
        uint16 bps;
        uint64 lastUpdated;
        bytes32 sourceId;
        bool exists;
    }

    /// @notice MUST be emitted by native implementations whenever a rate is set or changed.
    ///         Adapters over a legacy feed MAY omit it and point integrators at the source's own event.
    event TariffRateUpdated(
        bytes32 indexed key, string route, string hsCode, uint16 bps, uint64 lastUpdated, bytes32 indexed sourceId
    );

    /// @notice Thrown by tariffRate() when the (route, hsCode) pair is not published.
    error TariffRateNotFound(bytes32 key);

    /// @notice Canonical key: keccak256(abi.encode(route, hsCode)).
    function tariffKey(string calldata route, string calldata hsCode) external pure returns (bytes32);

    /// @notice Rate for a pair. MUST revert with TariffRateNotFound if unset.
    /// @return bps ad-valorem rate in basis points (0..10_000)
    /// @return lastUpdated unix seconds when the rate was last written on-chain
    /// @return sourceId bytes32 identifier of the data source, e.g. bytes32("USITC-HTS")
    function tariffRate(string calldata route, string calldata hsCode)
        external
        view
        returns (uint16 bps, uint64 lastUpdated, bytes32 sourceId);

    /// @notice Batch read. MUST NOT revert for unset pairs (returns exists = false). Arrays MUST be equal length.
    function tariffRates(string[] calldata routes, string[] calldata hsCodes)
        external
        view
        returns (TariffRate[] memory rates);

    /// @notice Standard version implemented; 1 for TFS-1.
    function tfsVersion() external pure returns (uint16);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITariffFeed} from "./interfaces/ITariffFeed.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface ILegacyTariffOracle {
    function getRate(string calldata route, string calldata hsCode) external view returns (uint16 bps, uint64 updatedAt);
}

/// @title TariffFeedAdapter: read-only TFS-1 view over an existing TariffOracle
/// @notice No owner, no storage writes, no upgrade path. Rate updates are the source oracle's
///         `RateSet(bytes32 indexed key, string route, string hsCode, uint16 bps)` events.
contract TariffFeedAdapter is ITariffFeed {
    ILegacyTariffOracle public immutable source;
    bytes32 public immutable sourceId;

    error ZeroSource();
    error LengthMismatch();

    constructor(address source_, bytes32 sourceId_) {
        if (source_.code.length == 0) revert ZeroSource();
        source = ILegacyTariffOracle(source_);
        sourceId = sourceId_;
    }

    function tariffKey(string calldata route, string calldata hsCode) public pure returns (bytes32) {
        return keccak256(abi.encode(route, hsCode));
    }

    function tariffRate(string calldata route, string calldata hsCode)
        external
        view
        returns (uint16 bps, uint64 lastUpdated, bytes32 sid)
    {
        try source.getRate(route, hsCode) returns (uint16 b, uint64 t) {
            return (b, t, sourceId);
        } catch {
            revert TariffRateNotFound(tariffKey(route, hsCode));
        }
    }

    function tariffRates(string[] calldata routes, string[] calldata hsCodes)
        external
        view
        returns (TariffRate[] memory out)
    {
        if (routes.length != hsCodes.length) revert LengthMismatch();
        out = new TariffRate[](routes.length);
        for (uint256 i; i < routes.length; ++i) {
            try source.getRate(routes[i], hsCodes[i]) returns (uint16 b, uint64 t) {
                out[i] = TariffRate(b, t, sourceId, true);
            } catch {}
        }
    }

    function tfsVersion() external pure returns (uint16) {
        return 1;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(ITariffFeed).interfaceId || id == type(IERC165).interfaceId;
    }
}

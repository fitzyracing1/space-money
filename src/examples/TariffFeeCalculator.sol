// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITariffFeed} from "../interfaces/ITariffFeed.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title TariffFeeCalculator: example TFS-1 consumer (stablecoin duty quote)
/// @notice Quotes the import duty on a declared customs value in any token/stablecoin units.
///         Rejects feeds that don't advertise TFS-1, unset rates, future timestamps and stale rates.
contract TariffFeeCalculator {
    ITariffFeed public immutable feed;
    uint64 public immutable maxAge;

    error NotATariffFeed(address feed);
    error StaleRate(uint64 lastUpdated, uint64 maxAge);
    error FutureTimestamp(uint64 lastUpdated);

    constructor(address feed_, uint64 maxAge_) {
        bool ok;
        try IERC165(feed_).supportsInterface(type(ITariffFeed).interfaceId) returns (bool s) { ok = s; } catch {}
        if (!ok) revert NotATariffFeed(feed_);
        feed = ITariffFeed(feed_);
        maxAge = maxAge_;
    }

    /// @return duty value * bps / 10_000 (rounded down), in the same units as `value`
    /// @return bps the rate used
    function quote(string calldata route, string calldata hsCode, uint256 value)
        external
        view
        returns (uint256 duty, uint16 bps)
    {
        uint64 t;
        (bps, t,) = feed.tariffRate(route, hsCode); // reverts TariffRateNotFound if unset
        if (t > block.timestamp) revert FutureTimestamp(t);
        if (block.timestamp - t > maxAge) revert StaleRate(t, maxAge);
        duty = value * bps / 10_000;
    }
}

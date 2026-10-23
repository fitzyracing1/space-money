// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title TariffOracle — tariff rates (basis points, ad valorem) per route + HS code
contract TariffOracle is AccessControl {
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    uint16 public constant MAX_BPS = 10_000;

    struct Rate {
        uint16 bps;
        uint64 updatedAt;
        bool exists;
    }

    mapping(bytes32 => Rate) private _rates;

    event RateSet(bytes32 indexed key, string route, string hsCode, uint16 bps);
    event RateRemoved(bytes32 indexed key);

    error RateTooHigh(uint16 bps);
    error RateNotFound(bytes32 key);
    error LengthMismatch();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function keyOf(string memory route, string memory hsCode) public pure returns (bytes32) {
        return keccak256(abi.encode(route, hsCode));
    }

    function setRate(string calldata route, string calldata hsCode, uint16 bps) public onlyRole(UPDATER_ROLE) {
        if (bps > MAX_BPS) revert RateTooHigh(bps);
        bytes32 k = keyOf(route, hsCode);
        _rates[k] = Rate(bps, uint64(block.timestamp), true);
        emit RateSet(k, route, hsCode, bps);
    }

    function setRates(string[] calldata routes, string[] calldata hsCodes, uint16[] calldata bps)
        external
        onlyRole(UPDATER_ROLE)
    {
        if (routes.length != hsCodes.length || routes.length != bps.length) revert LengthMismatch();
        for (uint256 i; i < routes.length; ++i) {
            setRate(routes[i], hsCodes[i], bps[i]);
        }
    }

    function removeRate(string calldata route, string calldata hsCode) external onlyRole(UPDATER_ROLE) {
        bytes32 k = keyOf(route, hsCode);
        if (!_rates[k].exists) revert RateNotFound(k);
        delete _rates[k];
        emit RateRemoved(k);
    }

    function getRate(string calldata route, string calldata hsCode) external view returns (uint16 bps, uint64 updatedAt) {
        bytes32 k = keyOf(route, hsCode);
        Rate memory r = _rates[k];
        if (!r.exists) revert RateNotFound(k);
        return (r.bps, r.updatedAt);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ITariffFeed} from "./interfaces/ITariffFeed.sol";
import {ITariffFeedSpecific} from "./interfaces/ITariffFeedSpecific.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title TariffFeedV2 ("FeedV2"): TFS-1 + TFS-1a feed with a Merkle-root mode for the full HTS schedule
/// @notice Two ways a rate gets on-chain:
///   1. UPDATER writes it directly (setRatesV2), for a hot subset.
///   2. UPDATER publishes one Merkle root per HTS revision (publishRoot). Anyone can then verify a rate against
///      the root for free (verifyRate, a view), or pay gas to materialize it into storage (proveRate) so that plain
///      TFS-1/TFS-1a readers see it. Materialized rates carry the root's publish time as lastUpdated, so staleness
///      checks reflect when the data was attested, not when someone paid gas.
/// Leaf = keccak256(bytes.concat(keccak256(abi.encode(route, hsCode, uint8 rateType, uint32 bps,
///        uint64 amountMicro, bytes16 unit, bytes3 currency)))). Pairs are sorted (OpenZeppelin MerkleProof).
/// NOT DEPLOYED. Testnet/fork only until an explicit decision.
contract TariffFeedV2 is ITariffFeed, ITariffFeedSpecific, AccessControl {
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    struct Stored {
        RateType rateType;
        uint32 bps;
        uint64 amountMicro;
        bytes16 unit;
        bytes3 currency;
        uint64 lastUpdated;
        bool exists;
    }

    struct Root {
        bytes32 root;
        uint64 publishedAt;
        uint32 leafCount;
        string revision; // e.g. "2026HTSRev21"
        string uri; // where the leaves live, e.g. the repo path / IPFS CID
    }

    bytes32 public immutable sourceId;
    mapping(bytes32 => Stored) internal _rates;
    Root public currentRoot;

    event RootPublished(bytes32 indexed root, string revision, uint32 leafCount, string uri, uint64 publishedAt);

    error LengthMismatch();
    error InvalidProof();
    error NoRoot();
    error BadRate();
    error TariffRateNotAdValorem(bytes32 key);

    constructor(address admin, bytes32 sourceId_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPDATER_ROLE, admin);
        sourceId = sourceId_;
    }

    // ------------------------------------------------------------------ writes

    function setRatesV2(string[] calldata routes, string[] calldata hsCodes, TariffRateV2[] calldata rates)
        external
        onlyRole(UPDATER_ROLE)
    {
        if (routes.length != hsCodes.length || routes.length != rates.length) revert LengthMismatch();
        uint64 t = uint64(block.timestamp);
        for (uint256 i; i < routes.length; ++i) {
            TariffRateV2 calldata r = rates[i];
            _write(routes[i], hsCodes[i], r.rateType, r.bps, r.amountMicro, r.unit, r.currency, t);
        }
    }

    function publishRoot(bytes32 root, uint32 leafCount, string calldata revision, string calldata uri)
        external
        onlyRole(UPDATER_ROLE)
    {
        uint64 t = uint64(block.timestamp);
        currentRoot = Root(root, t, leafCount, revision, uri);
        emit RootPublished(root, revision, leafCount, uri, t);
    }

    /// @notice One Merkle leaf (also the argument shape for proveRate / verifyRate).
    struct RateLeaf {
        string route;
        string hsCode;
        RateType rateType;
        uint32 bps;
        uint64 amountMicro;
        bytes16 unit;
        bytes3 currency;
    }

    /// @notice Permissionless: materialize a rate proven against the current root.
    function proveRate(RateLeaf calldata l, bytes32[] calldata proof) external {
        if (currentRoot.root == bytes32(0)) revert NoRoot();
        if (!verifyRate(l, proof)) revert InvalidProof();
        _write(l.route, l.hsCode, l.rateType, l.bps, l.amountMicro, l.unit, l.currency, currentRoot.publishedAt);
    }

    // ------------------------------------------------------------------ views

    function leafHash(RateLeaf calldata l) public pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(abi.encode(l.route, l.hsCode, uint8(l.rateType), l.bps, l.amountMicro, l.unit, l.currency))
            )
        );
    }

    /// @notice Free (view) check that a rate is part of the currently published revision.
    function verifyRate(RateLeaf calldata l, bytes32[] calldata proof) public view returns (bool) {
        return currentRoot.root != bytes32(0) && MerkleProof.verifyCalldata(proof, currentRoot.root, leafHash(l));
    }

    function tariffKey(string calldata route, string calldata hsCode) public pure returns (bytes32) {
        return keccak256(abi.encode(route, hsCode));
    }

    /// @inheritdoc ITariffFeed
    function tariffRate(string calldata route, string calldata hsCode)
        external
        view
        returns (uint16 bps, uint64 lastUpdated, bytes32 sid)
    {
        bytes32 k = tariffKey(route, hsCode);
        Stored storage s = _rates[k];
        if (!s.exists) revert TariffRateNotFound(k);
        if (!_tfs1(s)) revert TariffRateNotAdValorem(k);
        return (uint16(s.bps), s.lastUpdated, sourceId);
    }

    /// @inheritdoc ITariffFeed
    function tariffRates(string[] calldata routes, string[] calldata hsCodes)
        external
        view
        returns (TariffRate[] memory out)
    {
        if (routes.length != hsCodes.length) revert LengthMismatch();
        out = new TariffRate[](routes.length);
        for (uint256 i; i < routes.length; ++i) {
            Stored storage s = _rates[tariffKey(routes[i], hsCodes[i])];
            if (s.exists && _tfs1(s)) out[i] = TariffRate(uint16(s.bps), s.lastUpdated, sourceId, true);
        }
    }

    /// @inheritdoc ITariffFeedSpecific
    function tariffRateV2(string calldata route, string calldata hsCode) external view returns (TariffRateV2 memory r) {
        bytes32 k = tariffKey(route, hsCode);
        r = _v2(_rates[k]);
        if (!r.exists) revert TariffRateNotFound(k);
    }

    /// @inheritdoc ITariffFeedSpecific
    function tariffRatesV2(string[] calldata routes, string[] calldata hsCodes)
        external
        view
        returns (TariffRateV2[] memory out)
    {
        if (routes.length != hsCodes.length) revert LengthMismatch();
        out = new TariffRateV2[](routes.length);
        for (uint256 i; i < routes.length; ++i) {
            out[i] = _v2(_rates[tariffKey(routes[i], hsCodes[i])]);
        }
    }

    /// @notice Base standard version stays 1; the TFS-1a extension is discovered via ERC-165.
    function tfsVersion() external pure returns (uint16) {
        return 1;
    }

    function supportsInterface(bytes4 id) public view override(AccessControl, IERC165) returns (bool) {
        return id == type(ITariffFeed).interfaceId || id == type(ITariffFeedSpecific).interfaceId
            || super.supportsInterface(id);
    }

    // ------------------------------------------------------------------ internal

    function _tfs1(Stored storage s) internal view returns (bool) {
        return (s.rateType == RateType.Free || s.rateType == RateType.AdValorem) && s.bps <= 10_000;
    }

    function _v2(Stored storage s) internal view returns (TariffRateV2 memory) {
        if (!s.exists) return TariffRateV2(RateType.Free, 0, 0, bytes16(0), bytes3(0), 0, bytes32(0), false);
        return TariffRateV2(s.rateType, s.bps, s.amountMicro, s.unit, s.currency, s.lastUpdated, sourceId, true);
    }

    function _write(
        string calldata route,
        string calldata hsCode,
        RateType rt,
        uint32 bps,
        uint64 amt,
        bytes16 unit,
        bytes3 cur,
        uint64 t
    ) internal {
        bool hasAv = rt == RateType.AdValorem || rt == RateType.Compound;
        bool hasSp = rt == RateType.Specific || rt == RateType.Compound;
        if (
            (!hasAv && bps != 0) || (!hasSp && (amt != 0 || unit != 0 || cur != 0))
                || (hasSp && (unit == 0 || cur == 0))
        ) {
            revert BadRate();
        }
        bytes32 k = tariffKey(route, hsCode);
        _rates[k] = Stored(rt, bps, amt, unit, cur, t, true);
        emit TariffRateV2Updated(k, route, hsCode, rt, bps, amt, unit, cur, t, sourceId);
        if ((rt == RateType.Free || rt == RateType.AdValorem) && bps <= 10_000) {
            emit TariffRateUpdated(k, route, hsCode, uint16(bps), t, sourceId);
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TariffOracle} from "./TariffOracle.sol";

/// @title TariffRouter — pays a shipment's tariff in SPACE, splitting reserve/treasury
contract TariffRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    uint16 public constant BPS = 10_000;

    IERC20 public immutable token;
    TariffOracle public immutable oracle;
    address public reserve;
    address public treasury;
    uint16 public reserveShareBps;

    mapping(bytes32 => bool) public paid;

    event TariffPaid(
        bytes32 indexed shipmentId,
        address indexed payer,
        string route,
        string hsCode,
        uint256 declaredValue,
        uint256 fee,
        uint256 toReserve,
        uint256 toTreasury
    );
    event ReserveShareSet(uint16 bps);
    event DestinationsSet(address reserve, address treasury);

    error ZeroAddress();
    error ShareTooHigh(uint16 bps);
    error AlreadyPaid(bytes32 shipmentId);
    error ZeroValue();
    error FeeExceedsMax(uint256 fee, uint256 maxFee);

    constructor(address admin, IERC20 token_, TariffOracle oracle_, address reserve_, address treasury_, uint16 shareBps)
    {
        if (address(token_) == address(0) || address(oracle_) == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        token = token_;
        oracle = oracle_;
        _setDestinations(reserve_, treasury_);
        _setShare(shareBps);
    }

    function quote(string calldata route, string calldata hsCode, uint256 declaredValue)
        public
        view
        returns (uint256 fee, uint256 toReserve, uint256 toTreasury)
    {
        (uint16 rate,) = oracle.getRate(route, hsCode);
        fee = declaredValue * rate / BPS;
        toReserve = fee * reserveShareBps / BPS;
        toTreasury = fee - toReserve;
    }

    /// @param maxFee slippage guard against a rate update between quote and pay
    function payTariff(
        bytes32 shipmentId,
        string calldata route,
        string calldata hsCode,
        uint256 declaredValue,
        uint256 maxFee
    ) external nonReentrant returns (uint256 fee) {
        if (declaredValue == 0) revert ZeroValue();
        if (paid[shipmentId]) revert AlreadyPaid(shipmentId);
        uint256 toReserve;
        uint256 toTreasury;
        (fee, toReserve, toTreasury) = quote(route, hsCode, declaredValue);
        if (fee > maxFee) revert FeeExceedsMax(fee, maxFee);
        paid[shipmentId] = true;
        if (toReserve > 0) token.safeTransferFrom(msg.sender, reserve, toReserve);
        if (toTreasury > 0) token.safeTransferFrom(msg.sender, treasury, toTreasury);
        emit TariffPaid(shipmentId, msg.sender, route, hsCode, declaredValue, fee, toReserve, toTreasury);
    }

    function setReserveShare(uint16 bps) external onlyRole(CONFIG_ROLE) {
        _setShare(bps);
    }

    function setDestinations(address reserve_, address treasury_) external onlyRole(CONFIG_ROLE) {
        _setDestinations(reserve_, treasury_);
    }

    function _setShare(uint16 bps) internal {
        if (bps > BPS) revert ShareTooHigh(bps);
        reserveShareBps = bps;
        emit ReserveShareSet(bps);
    }

    function _setDestinations(address reserve_, address treasury_) internal {
        if (reserve_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        reserve = reserve_;
        treasury = treasury_;
        emit DestinationsSet(reserve_, treasury_);
    }
}

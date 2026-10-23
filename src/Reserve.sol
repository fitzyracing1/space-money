// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Reserve — accumulates the reserve share of tariff fees.
/// @notice The fees held here (not the tariff data) are what back SPACE in this prototype.
contract Reserve is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");
    IERC20 public immutable token;

    event Withdrawn(address indexed to, uint256 amount);

    constructor(address admin, IERC20 token_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        token = token_;
    }

    function balance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function withdraw(address to, uint256 amount) external onlyRole(WITHDRAWER_ROLE) {
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }
}

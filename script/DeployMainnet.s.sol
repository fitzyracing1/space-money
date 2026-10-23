// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SpaceToken} from "../src/SpaceToken.sol";
import {TariffOracle} from "../src/TariffOracle.sol";
import {Reserve} from "../src/Reserve.sol";
import {TariffRouter} from "../src/TariffRouter.sol";

/// Guarded MAINNET deploy. NOT run by this repo or CI. See MAINNET.md.
/// Requires: chain id 1, CONFIRM_MAINNET=yes, ADMIN=<EOA or Safe>. Optional: ORACLE_UPDATER (default ADMIN),
/// TREASURY (default ADMIN), RESERVE_SHARE_BPS (default 2000).
/// All admin/config/minter/withdrawer roles go to ADMIN. If the deployer is a different address it then
/// renounces DEFAULT_ADMIN_ROLE everywhere; if deployer == ADMIN it keeps the roles (it *is* the admin).
contract DeployMainnet is Script {
    struct Deployed {
        SpaceToken token;
        TariffOracle oracle;
        Reserve reserve;
        TariffRouter router;
    }

    function run() external returns (Deployed memory d) {
        require(block.chainid == 1, "DeployMainnet: chain id must be 1");
        require(keccak256(bytes(vm.envOr("CONFIRM_MAINNET", string("")))) == keccak256("yes"), "DeployMainnet: set CONFIRM_MAINNET=yes");
        address admin = vm.envOr("ADMIN", address(0));
        require(admin != address(0), "DeployMainnet: ADMIN required (EOA or Safe)");
        address updater = vm.envOr("ORACLE_UPDATER", admin);
        address treasury = vm.envOr("TREASURY", admin);
        uint16 share = uint16(vm.envOr("RESERVE_SHARE_BPS", uint256(2000)));

        vm.startBroadcast();
        d = deployAndHandOff(msg.sender, admin, updater, treasury, share);
        vm.stopBroadcast();

        console.log("TOKEN=%s", address(d.token));
        console.log("ORACLE=%s", address(d.oracle));
        console.log("RESERVE=%s", address(d.reserve));
        console.log("ROUTER=%s", address(d.router));
    }

    /// `deployer` is whoever sends the calls (the broadcaster in run(), this contract in tests).
    function deployAndHandOff(address deployer, address admin, address updater, address treasury, uint16 share)
        public
        returns (Deployed memory d)
    {
        require(admin != address(0) && updater != address(0), "DeployMainnet: zero address");
        d.token = new SpaceToken(deployer);
        d.oracle = new TariffOracle(deployer);
        d.reserve = new Reserve(deployer, d.token);
        d.router = new TariffRouter(deployer, d.token, d.oracle, address(d.reserve), treasury, share);

        bytes32 ADM = 0x00;
        d.token.grantRole(d.token.MINTER_ROLE(), admin);
        d.token.grantRole(ADM, admin);
        d.oracle.grantRole(d.oracle.UPDATER_ROLE(), updater);
        d.oracle.grantRole(ADM, admin);
        d.reserve.grantRole(d.reserve.WITHDRAWER_ROLE(), admin);
        d.reserve.grantRole(ADM, admin);
        d.router.grantRole(d.router.CONFIG_ROLE(), admin);
        d.router.grantRole(ADM, admin);

        if (deployer != admin) {
            d.token.renounceRole(ADM, deployer);
            d.oracle.renounceRole(ADM, deployer);
            d.reserve.renounceRole(ADM, deployer);
            d.router.renounceRole(ADM, deployer);
        }
    }
}

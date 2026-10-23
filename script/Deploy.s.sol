// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SpaceToken} from "../src/SpaceToken.sol";
import {TariffOracle} from "../src/TariffOracle.sol";
import {Reserve} from "../src/Reserve.sol";
import {TariffRouter} from "../src/TariffRouter.sol";

/// Deploys the full stack. Local anvil by default. Refuses chain id 1 (mainnet).
contract Deploy is Script {
    function run() external {
        require(block.chainid != 1, "mainnet deploy disabled: prototype only");
        address treasury = vm.envOr("TREASURY", msg.sender);
        uint16 share = uint16(vm.envOr("RESERVE_SHARE_BPS", uint256(2000)));

        vm.startBroadcast();
        address admin = msg.sender;
        SpaceToken token = new SpaceToken(admin);
        TariffOracle oracle = new TariffOracle(admin);
        Reserve reserve = new Reserve(admin, token);
        TariffRouter router = new TariffRouter(admin, token, oracle, address(reserve), treasury, share);
        token.grantRole(token.MINTER_ROLE(), admin);
        oracle.grantRole(oracle.UPDATER_ROLE(), admin);
        router.grantRole(router.CONFIG_ROLE(), admin);
        vm.stopBroadcast();

        console.log("TOKEN=%s", address(token));
        console.log("ORACLE=%s", address(oracle));
        console.log("RESERVE=%s", address(reserve));
        console.log("ROUTER=%s", address(router));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SpaceToken} from "../src/SpaceToken.sol";
import {TariffOracle} from "../src/TariffOracle.sol";
import {Reserve} from "../src/Reserve.sol";
import {TariffRouter} from "../src/TariffRouter.sol";

/// Guarded MAINNET deploy. NOT run by this repo or CI. See MAINNET.md.
/// Requires: chain id 1, CONFIRM_MAINNET=yes, SAFE=<deployed Safe multisig>, ORACLE_UPDATER=<updater address>.
/// All admin/config/minter/withdrawer roles go to the Safe; the deployer renounces every role it held.
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
        address safe = vm.envAddress("SAFE");
        require(safe != address(0) && safe.code.length > 0, "DeployMainnet: SAFE must be a deployed contract");
        address updater = vm.envAddress("ORACLE_UPDATER");
        require(updater != address(0), "DeployMainnet: ORACLE_UPDATER required");
        address treasury = vm.envOr("TREASURY", safe);
        uint16 share = uint16(vm.envOr("RESERVE_SHARE_BPS", uint256(2000)));

        vm.startBroadcast();
        d = deployAndHandOff(msg.sender, safe, updater, treasury, share);
        vm.stopBroadcast();

        console.log("TOKEN=%s", address(d.token));
        console.log("ORACLE=%s", address(d.oracle));
        console.log("RESERVE=%s", address(d.reserve));
        console.log("ROUTER=%s", address(d.router));
    }

    /// `deployer` is whoever sends the calls (the broadcaster in run(), this contract in tests).
    function deployAndHandOff(address deployer, address safe, address updater, address treasury, uint16 share)
        public
        returns (Deployed memory d)
    {
        require(deployer != safe, "DeployMainnet: deployer must not be the Safe");
        d.token = new SpaceToken(deployer);
        d.oracle = new TariffOracle(deployer);
        d.reserve = new Reserve(deployer, d.token);
        d.router = new TariffRouter(deployer, d.token, d.oracle, address(d.reserve), treasury, share);

        bytes32 admin = 0x00;
        d.token.grantRole(d.token.MINTER_ROLE(), safe);
        d.token.grantRole(admin, safe);
        d.oracle.grantRole(d.oracle.UPDATER_ROLE(), updater);
        d.oracle.grantRole(admin, safe);
        d.reserve.grantRole(d.reserve.WITHDRAWER_ROLE(), safe);
        d.reserve.grantRole(admin, safe);
        d.router.grantRole(d.router.CONFIG_ROLE(), safe);
        d.router.grantRole(admin, safe);

        d.token.renounceRole(admin, deployer);
        d.oracle.renounceRole(admin, deployer);
        d.reserve.renounceRole(admin, deployer);
        d.router.renounceRole(admin, deployer);
    }
}

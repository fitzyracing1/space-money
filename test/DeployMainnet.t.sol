// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployMainnet} from "../script/DeployMainnet.s.sol";

contract SafeStub {}

/// Env vars are process-global, so all guard checks live in one sequential test.
contract DeployMainnetTest is Test {
    function test_Guards() public {
        DeployMainnet s = new DeployMainnet();
        address safe = address(new SafeStub());
        vm.setEnv("SAFE", vm.toString(safe));
        vm.setEnv("ORACLE_UPDATER", vm.toString(makeAddr("updater")));

        vm.chainId(11155111);
        vm.setEnv("CONFIRM_MAINNET", "yes");
        vm.expectRevert("DeployMainnet: chain id must be 1");
        s.run();

        vm.chainId(1);
        vm.setEnv("CONFIRM_MAINNET", "no");
        vm.expectRevert("DeployMainnet: set CONFIRM_MAINNET=yes");
        s.run();

        vm.setEnv("CONFIRM_MAINNET", "yes");
        vm.setEnv("SAFE", vm.toString(makeAddr("eoa")));
        vm.expectRevert("DeployMainnet: SAFE must be a deployed contract");
        s.run();
        vm.setEnv("CONFIRM_MAINNET", "");
    }

    function test_RolesMoveToSafeAndDeployerRenounces() public {
        DeployMainnet s = new DeployMainnet();
        address safe = address(new SafeStub());
        address updater = makeAddr("updater");
        DeployMainnet.Deployed memory d = s.deployAndHandOff(address(s), safe, updater, safe, 2000);
        bytes32 a = 0x00;
        address dep = address(s);
        assertTrue(d.token.hasRole(a, safe));
        assertTrue(d.token.hasRole(d.token.MINTER_ROLE(), safe));
        assertTrue(d.oracle.hasRole(a, safe));
        assertTrue(d.oracle.hasRole(d.oracle.UPDATER_ROLE(), updater));
        assertTrue(d.reserve.hasRole(a, safe));
        assertTrue(d.reserve.hasRole(d.reserve.WITHDRAWER_ROLE(), safe));
        assertTrue(d.router.hasRole(a, safe));
        assertTrue(d.router.hasRole(d.router.CONFIG_ROLE(), safe));
        assertEq(d.router.treasury(), safe);
        assertEq(d.router.reserveShareBps(), 2000);
        assertFalse(d.token.hasRole(a, dep));
        assertFalse(d.oracle.hasRole(a, dep));
        assertFalse(d.reserve.hasRole(a, dep));
        assertFalse(d.router.hasRole(a, dep));
        assertFalse(d.token.hasRole(d.token.MINTER_ROLE(), dep));
    }

    function test_RejectsDeployerAsSafe() public {
        DeployMainnet s = new DeployMainnet();
        vm.expectRevert("DeployMainnet: deployer must not be the Safe");
        s.deployAndHandOff(address(s), address(s), address(1), address(1), 2000);
    }
}

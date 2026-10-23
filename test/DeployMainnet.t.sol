// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployMainnet} from "../script/DeployMainnet.s.sol";

contract SafeStub {}

/// Env vars are process-global, so all env-driven guard checks live in one sequential test.
contract DeployMainnetTest is Test {
    bytes32 constant A = 0x00;

    function test_Guards() public {
        DeployMainnet s = new DeployMainnet();
        vm.setEnv("ADMIN", vm.toString(makeAddr("eoaAdmin")));

        vm.chainId(11155111);
        vm.setEnv("CONFIRM_MAINNET", "yes");
        vm.expectRevert("DeployMainnet: chain id must be 1");
        s.run();

        vm.chainId(1);
        vm.setEnv("CONFIRM_MAINNET", "no");
        vm.expectRevert("DeployMainnet: set CONFIRM_MAINNET=yes");
        s.run();

        vm.setEnv("CONFIRM_MAINNET", "yes");
        vm.setEnv("ADMIN", vm.toString(address(0)));
        vm.expectRevert("DeployMainnet: ADMIN required (EOA or Safe)");
        s.run();
        vm.setEnv("CONFIRM_MAINNET", "");
    }

    function _check(DeployMainnet.Deployed memory d, address admin, address updater, address dep) internal view {
        assertTrue(d.token.hasRole(A, admin));
        assertTrue(d.token.hasRole(d.token.MINTER_ROLE(), admin));
        assertTrue(d.oracle.hasRole(A, admin));
        assertTrue(d.oracle.hasRole(d.oracle.UPDATER_ROLE(), updater));
        assertTrue(d.reserve.hasRole(A, admin));
        assertTrue(d.reserve.hasRole(d.reserve.WITHDRAWER_ROLE(), admin));
        assertTrue(d.router.hasRole(A, admin));
        assertTrue(d.router.hasRole(d.router.CONFIG_ROLE(), admin));
        assertEq(d.router.treasury(), admin);
        assertEq(d.router.reserveShareBps(), 2000);
        if (dep != admin) {
            assertFalse(d.token.hasRole(A, dep));
            assertFalse(d.oracle.hasRole(A, dep));
            assertFalse(d.reserve.hasRole(A, dep));
            assertFalse(d.router.hasRole(A, dep));
            assertFalse(d.token.hasRole(d.token.MINTER_ROLE(), dep));
        }
    }

    function test_EoaAdminDeployerRenounces() public {
        DeployMainnet s = new DeployMainnet();
        address eoa = makeAddr("eoaAdmin");
        assertEq(eoa.code.length, 0);
        _check(s.deployAndHandOff(address(s), eoa, eoa, eoa, 2000), eoa, eoa, address(s));
    }

    function test_SafeAdminStillWorks() public {
        DeployMainnet s = new DeployMainnet();
        address safe = address(new SafeStub());
        address upd = makeAddr("updater");
        _check(s.deployAndHandOff(address(s), safe, upd, safe, 2000), safe, upd, address(s));
    }

    function test_DeployerIsAdminKeepsRoles() public {
        DeployMainnet s = new DeployMainnet();
        DeployMainnet.Deployed memory d = s.deployAndHandOff(address(s), address(s), address(s), address(s), 2000);
        _check(d, address(s), address(s), address(s));
    }

    function test_RejectsZeroAdmin() public {
        DeployMainnet s = new DeployMainnet();
        vm.expectRevert("DeployMainnet: zero address");
        s.deployAndHandOff(address(s), address(0), address(1), address(1), 2000);
    }
}

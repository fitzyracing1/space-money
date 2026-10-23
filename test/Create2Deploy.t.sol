// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SpaceToken} from "../src/SpaceToken.sol";
import {TariffOracle} from "../src/TariffOracle.sol";
import {Reserve} from "../src/Reserve.sol";
import {TariffRouter} from "../src/TariffRouter.sol";

/// Mirrors site/deploy.js: every contract is created by the deterministic CREATE2 deployer
/// (msg.sender in the constructor is the factory), so admin must come from constructor args.
contract Create2DeployTest is Test {
    address constant FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address admin = makeAddr("smartWalletAdmin");

    function setUp() public {
        vm.etch(FACTORY, hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3");
    }

    function _salt(string memory name) internal view returns (bytes32) {
        return keccak256(abi.encode(admin, "space-money/v1", name));
    }

    function _deploy(string memory name, bytes memory init) internal returns (address predicted) {
        bytes32 salt = _salt(name);
        predicted = vm.computeCreate2Address(salt, keccak256(init), FACTORY);
        vm.prank(admin);
        (bool ok, bytes memory ret) = FACTORY.call(abi.encodePacked(salt, init));
        assertTrue(ok);
        assertEq(address(bytes20(ret)), predicted);
        assertGt(predicted.code.length, 0);
    }

    function test_factoryDeploy_adminIsConstructorArg_notFactory() public {
        address t = _deploy("SpaceToken", abi.encodePacked(type(SpaceToken).creationCode, abi.encode(admin)));
        address o = _deploy("TariffOracle", abi.encodePacked(type(TariffOracle).creationCode, abi.encode(admin)));
        address r = _deploy("Reserve", abi.encodePacked(type(Reserve).creationCode, abi.encode(admin, t)));
        address x = _deploy("TariffRouter",
            abi.encodePacked(type(TariffRouter).creationCode, abi.encode(admin, t, o, r, admin, uint16(2000))));
        bytes32 A = 0x00;
        assertTrue(SpaceToken(t).hasRole(A, admin));
        assertTrue(TariffOracle(o).hasRole(A, admin));
        assertTrue(Reserve(r).hasRole(A, admin));
        assertTrue(TariffRouter(x).hasRole(A, admin));
        assertFalse(SpaceToken(t).hasRole(A, FACTORY));
        assertFalse(TariffOracle(o).hasRole(A, FACTORY));
        assertFalse(Reserve(r).hasRole(A, FACTORY));
        assertFalse(TariffRouter(x).hasRole(A, FACTORY));
        assertEq(TariffRouter(x).treasury(), admin);

        // Re-sending the same deploy is rejected by the factory (address taken) -> page skips instead.
        vm.prank(admin);
        (bool ok,) = FACTORY.call(abi.encodePacked(_salt("SpaceToken"), type(SpaceToken).creationCode, abi.encode(admin)));
        assertFalse(ok);

        // Role grants from the admin wallet still work as normal calls.
        vm.startPrank(admin);
        SpaceToken(t).grantRole(SpaceToken(t).MINTER_ROLE(), admin);
        vm.stopPrank();
        assertTrue(SpaceToken(t).hasRole(SpaceToken(t).MINTER_ROLE(), admin));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SpaceToken} from "../src/SpaceToken.sol";
import {SpaceLog} from "../src/SpaceLog.sol";

contract SpaceLogTest is Test {
    SpaceToken token;
    SpaceLog sl;
    address admin = address(this);
    address treasury = makeAddr("treasury");
    address user = makeAddr("user");
    address seller = makeAddr("seller");
    address repoWallet = makeAddr("repoWallet");

    function setUp() public {
        token = new SpaceToken(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        sl = new SpaceLog(token, admin, treasury);
        token.mint(user, 1_000_000e18);
        vm.prank(user);
        token.approve(address(sl), type(uint256).max);
    }

    function _repos() internal pure returns (string[] memory r) {
        r = new string[](2);
        r[0] = "fitzyracing1/space-money";
        r[1] = "someone/unregistered";
    }

    function _cf() internal pure returns (SpaceLog.Counterfactual memory) {
        // HS 6109 from VN at value 100: US 29, EU(PT) 23 VAT (0 duty), UK 20 VAT
        return SpaceLog.Counterfactual(29e18, 23e18, 20e18, true, true, true);
    }

    function _log() internal returns (uint256) {
        vm.prank(user);
        return sl.logEntry(SpaceLog.EntryInput("cotton t-shirt", "6109.10", "VN", "SpaceX Transporter SSO", 100e18, _cf(),
            SpaceLog.ExportAttestation.NotRequired, false), _repos());
    }

    function test_logEntry_records_everything() public {
        uint256 id = _log();
        SpaceLog.Entry memory e = sl.getEntry(id);
        assertEq(e.logger, user);
        assertEq(e.hsCode, "6109.10");
        assertEq(e.counterfactual.us, 29e18);
        assertEq(uint8(e.attestation), uint8(SpaceLog.ExportAttestation.NotRequired));
        assertEq(e.creditedRepos.length, 2);
        assertEq(e.feePaid, 0);
        assertEq(sl.count(), 1);
    }

    function test_attestation_required() public {
        vm.prank(user);
        vm.expectRevert(SpaceLog.AttestationRequired.selector);
        sl.logEntry(SpaceLog.EntryInput("satellite", "8802.60", "US", "SSO", 1, _cf(), SpaceLog.ExportAttestation.None, true), _repos());
    }

    function test_optional_fee_goes_to_treasury() public {
        sl.setConfig(5e18, 0, treasury);
        uint256 id = _log();
        assertEq(token.balanceOf(treasury), 5e18);
        assertEq(sl.getEntry(id).feePaid, 5e18);
    }

    function test_sale_split_only_to_registered_optedin_repos() public {
        sl.setConfig(0, 1000, treasury); // 10%
        sl.registerRepo("FitzyRacing1/Space-Money", repoWallet); // case-insensitive
        uint256 id = _log();
        vm.prank(user);
        sl.settleSale(id, seller, 1000e18);
        // slice 100 split over 2 repos = 50 each; unregistered share stays with seller
        assertEq(token.balanceOf(repoWallet), 50e18);
        assertEq(token.balanceOf(seller), 950e18);
    }

    function test_no_split_by_default_and_optout() public {
        sl.registerRepo("fitzyracing1/space-money", repoWallet);
        uint256 id = _log();
        vm.prank(user);
        sl.settleSale(id, seller, 100e18);
        assertEq(token.balanceOf(seller), 100e18); // payoutBps defaults to 0

        sl.setConfig(0, 2000, treasury);
        vm.prank(repoWallet);
        sl.optOut("fitzyracing1/space-money");
        vm.prank(user);
        sl.settleSale(id, seller, 100e18);
        assertEq(token.balanceOf(repoWallet), 0);
        assertEq(token.balanceOf(seller), 200e18);
    }

    function test_config_guards() public {
        vm.expectRevert(SpaceLog.BadConfig.selector);
        sl.setConfig(0, 2001, treasury);
        vm.prank(user);
        vm.expectRevert();
        sl.registerRepo("x/y", user);
        vm.prank(user);
        vm.expectRevert(SpaceLog.NotRepoWallet.selector);
        sl.optOut("fitzyracing1/space-money");
    }

    function test_too_many_repos() public {
        string[] memory r = new string[](21);
        vm.prank(user);
        vm.expectRevert(SpaceLog.TooManyRepos.selector);
        sl.logEntry(SpaceLog.EntryInput("x", "1", "US", "SSO", 1, _cf(), SpaceLog.ExportAttestation.LicenseHeld, true), r);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SpaceToken} from "../src/SpaceToken.sol";
import {TariffOracle} from "../src/TariffOracle.sol";
import {Reserve} from "../src/Reserve.sol";
import {TariffRouter} from "../src/TariffRouter.sol";

contract SpaceMoneyTest is Test {
    SpaceToken token;
    TariffOracle oracle;
    Reserve reserve;
    TariffRouter router;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address treasury = makeAddr("treasury");
    address payer = makeAddr("payer");
    address rando = makeAddr("rando");

    string constant ROUTE = "CN->US";
    string constant HS = "9005.80.40";
    bytes32 constant SHIP = keccak256("ship-1");

    function setUp() public {
        vm.startPrank(admin);
        token = new SpaceToken(admin);
        oracle = new TariffOracle(admin);
        reserve = new Reserve(admin, token);
        router = new TariffRouter(admin, token, oracle, address(reserve), treasury, 2000);
        token.grantRole(token.MINTER_ROLE(), admin);
        oracle.grantRole(oracle.UPDATER_ROLE(), updater);
        router.grantRole(router.CONFIG_ROLE(), admin);
        reserve.grantRole(reserve.WITHDRAWER_ROLE(), admin);
        token.mint(payer, 1_000_000 ether);
        vm.stopPrank();
        vm.prank(updater);
        oracle.setRate(ROUTE, HS, 800); // 8%
        vm.prank(payer);
        token.approve(address(router), type(uint256).max);
    }

    function _pay(bytes32 id, uint256 v) internal returns (uint256) {
        vm.prank(payer);
        return router.payTariff(id, ROUTE, HS, v, type(uint256).max);
    }

    // ---------- fees ----------
    function test_FeeComputation() public view {
        (uint256 fee,,) = router.quote(ROUTE, HS, 10_000 ether);
        assertEq(fee, 800 ether);
    }

    function test_PayTariffTransfersFee() public {
        uint256 before = token.balanceOf(payer);
        uint256 fee = _pay(SHIP, 10_000 ether);
        assertEq(fee, 800 ether);
        assertEq(before - token.balanceOf(payer), 800 ether);
        assertTrue(router.paid(SHIP));
    }

    function test_FreeRateMovesNothing() public {
        vm.prank(updater);
        oracle.setRate(ROUTE, "6601.91.00.00", 0);
        vm.prank(payer);
        uint256 fee = router.payTariff(SHIP, ROUTE, "6601.91.00.00", 1 ether, 0);
        assertEq(fee, 0);
        assertEq(token.balanceOf(payer), 1_000_000 ether);
    }

    function test_FeeRoundsDown() public {
        // 1 wei * 8% = 0
        assertEq(_pay(SHIP, 1), 0);
        (uint256 fee,,) = router.quote(ROUTE, HS, 125);
        assertEq(fee, 10);
    }

    function test_EmitsTariffPaid() public {
        vm.expectEmit(true, true, false, true);
        emit TariffRouter.TariffPaid(SHIP, payer, ROUTE, HS, 10_000 ether, 800 ether, 160 ether, 640 ether);
        _pay(SHIP, 10_000 ether);
    }

    // ---------- reserve split ----------
    function test_ReserveSplit20Percent() public {
        _pay(SHIP, 10_000 ether);
        assertEq(token.balanceOf(address(reserve)), 160 ether);
        assertEq(token.balanceOf(treasury), 640 ether);
        assertEq(reserve.balance(), 160 ether);
    }

    function test_ReserveShareConfigurable() public {
        vm.prank(admin);
        router.setReserveShare(5000);
        _pay(SHIP, 10_000 ether);
        assertEq(token.balanceOf(address(reserve)), 400 ether);
        assertEq(token.balanceOf(treasury), 400 ether);
    }

    function test_ReserveShareZeroAndFull() public {
        vm.prank(admin);
        router.setReserveShare(0);
        _pay(SHIP, 10_000 ether);
        assertEq(token.balanceOf(address(reserve)), 0);
        vm.prank(admin);
        router.setReserveShare(10_000);
        _pay(keccak256("ship-2"), 10_000 ether);
        assertEq(token.balanceOf(address(reserve)), 800 ether);
        assertEq(token.balanceOf(treasury), 800 ether);
    }

    function testFuzz_SplitConserves(uint96 value, uint16 rate, uint16 share) public {
        rate = uint16(bound(rate, 0, 10_000));
        share = uint16(bound(share, 0, 10_000));
        vm.assume(value > 0);
        vm.prank(updater);
        oracle.setRate(ROUTE, HS, rate);
        vm.prank(admin);
        router.setReserveShare(share);
        vm.prank(admin);
        token.mint(payer, value);
        uint256 before = token.balanceOf(payer);
        uint256 fee = _pay(SHIP, value);
        assertEq(fee, uint256(value) * rate / 10_000);
        assertEq(token.balanceOf(address(reserve)) + token.balanceOf(treasury), fee);
        assertEq(before - token.balanceOf(payer), fee);
    }

    function test_ReserveWithdraw() public {
        _pay(SHIP, 10_000 ether);
        vm.prank(admin);
        reserve.withdraw(rando, 60 ether);
        assertEq(token.balanceOf(rando), 60 ether);
        assertEq(reserve.balance(), 100 ether);
    }

    // ---------- access control ----------
    function _expectUnauthorized(address who, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role));
    }

    function test_OnlyUpdaterSetsRate() public {
        _expectUnauthorized(rando, oracle.UPDATER_ROLE());
        vm.prank(rando);
        oracle.setRate(ROUTE, HS, 1);
    }

    function test_AdminIsNotImplicitlyUpdater() public {
        _expectUnauthorized(admin, oracle.UPDATER_ROLE());
        vm.prank(admin);
        oracle.setRate(ROUTE, HS, 1);
    }

    function test_OnlyUpdaterBatchAndRemove() public {
        string[] memory a = new string[](1);
        uint16[] memory b = new uint16[](1);
        _expectUnauthorized(rando, oracle.UPDATER_ROLE());
        vm.prank(rando);
        oracle.setRates(a, a, b);
        _expectUnauthorized(rando, oracle.UPDATER_ROLE());
        vm.prank(rando);
        oracle.removeRate(ROUTE, HS);
    }

    function test_OnlyConfigSetsShare() public {
        _expectUnauthorized(rando, router.CONFIG_ROLE());
        vm.prank(rando);
        router.setReserveShare(1);
    }

    function test_OnlyConfigSetsDestinations() public {
        _expectUnauthorized(rando, router.CONFIG_ROLE());
        vm.prank(rando);
        router.setDestinations(rando, rando);
    }

    function test_OnlyMinterMints() public {
        _expectUnauthorized(rando, token.MINTER_ROLE());
        vm.prank(rando);
        token.mint(rando, 1);
    }

    function test_OnlyWithdrawerWithdraws() public {
        _pay(SHIP, 10_000 ether);
        _expectUnauthorized(rando, reserve.WITHDRAWER_ROLE());
        vm.prank(rando);
        reserve.withdraw(rando, 1);
    }

    function test_RevokedUpdaterLosesAccess() public {
        vm.startPrank(admin);
        oracle.revokeRole(oracle.UPDATER_ROLE(), updater);
        vm.stopPrank();
        _expectUnauthorized(updater, oracle.UPDATER_ROLE());
        vm.prank(updater);
        oracle.setRate(ROUTE, HS, 1);
    }

    // ---------- edge cases ----------
    function test_RevertUnknownRate() public {
        bytes32 k = oracle.keyOf(ROUTE, "0000.00");
        vm.expectRevert(abi.encodeWithSelector(TariffOracle.RateNotFound.selector, k));
        vm.prank(payer);
        router.payTariff(SHIP, ROUTE, "0000.00", 1 ether, type(uint256).max);
    }

    function test_RouteIsPartOfKey() public {
        bytes32 k = oracle.keyOf("MX->US", HS);
        vm.expectRevert(abi.encodeWithSelector(TariffOracle.RateNotFound.selector, k));
        oracle.getRate("MX->US", HS);
    }

    function test_RevertDoublePay() public {
        _pay(SHIP, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(TariffRouter.AlreadyPaid.selector, SHIP));
        _pay(SHIP, 1 ether);
    }

    function test_RevertZeroValue() public {
        vm.expectRevert(TariffRouter.ZeroValue.selector);
        _pay(SHIP, 0);
    }

    function test_RevertMaxFeeSlippage() public {
        vm.expectRevert(abi.encodeWithSelector(TariffRouter.FeeExceedsMax.selector, 800 ether, 799 ether));
        vm.prank(payer);
        router.payTariff(SHIP, ROUTE, HS, 10_000 ether, 799 ether);
    }

    function test_RevertRateTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(TariffOracle.RateTooHigh.selector, 10_001));
        vm.prank(updater);
        oracle.setRate(ROUTE, HS, 10_001);
    }

    function test_RevertShareTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(TariffRouter.ShareTooHigh.selector, 10_001));
        vm.prank(admin);
        router.setReserveShare(10_001);
    }

    function test_RevertZeroDestinations() public {
        vm.startPrank(admin);
        vm.expectRevert(TariffRouter.ZeroAddress.selector);
        router.setDestinations(address(0), treasury);
        vm.expectRevert(TariffRouter.ZeroAddress.selector);
        router.setDestinations(address(reserve), address(0));
        vm.stopPrank();
    }

    function test_RevertConstructorZero() public {
        vm.expectRevert(TariffRouter.ZeroAddress.selector);
        new TariffRouter(admin, token, oracle, address(0), treasury, 2000);
        vm.expectRevert(abi.encodeWithSelector(TariffRouter.ShareTooHigh.selector, 10_001));
        new TariffRouter(admin, token, oracle, address(reserve), treasury, 10_001);
    }

    function test_RevertInsufficientAllowance() public {
        vm.prank(payer);
        token.approve(address(router), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, 160 ether)
        );
        _pay(SHIP, 10_000 ether);
    }

    function test_RevertInsufficientBalance() public {
        vm.prank(rando);
        token.approve(address(router), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, rando, 0, 160 ether)
        );
        vm.prank(rando);
        router.payTariff(SHIP, ROUTE, HS, 10_000 ether, type(uint256).max);
    }

    function test_FailedPayDoesNotMarkPaid() public {
        vm.prank(payer);
        token.approve(address(router), 0);
        vm.expectRevert();
        _pay(SHIP, 10_000 ether);
        assertFalse(router.paid(SHIP));
    }

    function test_RateUpdateAffectsNextPayment() public {
        vm.prank(updater);
        oracle.setRate(ROUTE, HS, 1000);
        assertEq(_pay(SHIP, 10_000 ether), 1000 ether);
    }

    function test_BatchSetRates() public {
        string[] memory r = new string[](2);
        string[] memory h = new string[](2);
        uint16[] memory b = new uint16[](2);
        (r[0], h[0], b[0]) = ("A", "1", 100);
        (r[1], h[1], b[1]) = ("B", "2", 200);
        vm.prank(updater);
        oracle.setRates(r, h, b);
        (uint16 x,) = oracle.getRate("B", "2");
        assertEq(x, 200);
    }

    function test_BatchLengthMismatch() public {
        vm.expectRevert(TariffOracle.LengthMismatch.selector);
        vm.prank(updater);
        oracle.setRates(new string[](1), new string[](2), new uint16[](1));
    }

    function test_RemoveRate() public {
        vm.prank(updater);
        oracle.removeRate(ROUTE, HS);
        vm.expectRevert();
        oracle.getRate(ROUTE, HS);
        vm.expectRevert();
        vm.prank(updater);
        oracle.removeRate(ROUTE, HS);
    }

    function test_RateTimestamp() public {
        vm.warp(12345);
        vm.prank(updater);
        oracle.setRate(ROUTE, HS, 5);
        (, uint64 t) = oracle.getRate(ROUTE, HS);
        assertEq(t, 12345);
    }

    function test_TokenMetadata() public view {
        assertEq(token.symbol(), "SPACE");
        assertEq(token.decimals(), 18);
    }
}

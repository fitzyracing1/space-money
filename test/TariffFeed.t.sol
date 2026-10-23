// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TariffOracle} from "../src/TariffOracle.sol";
import {TariffFeedAdapter} from "../src/TariffFeedAdapter.sol";
import {ITariffFeed} from "../src/interfaces/ITariffFeed.sol";
import {TariffFeeCalculator} from "../src/examples/TariffFeeCalculator.sol";

contract TariffFeedTest is Test {
    TariffOracle oracle;
    TariffFeedAdapter feed;
    bytes32 constant SRC = bytes32("USITC-HTS");
    string constant R = "ANY->US";

    function setUp() public {
        vm.warp(1_800_000_000);
        oracle = new TariffOracle(address(this));
        oracle.grantRole(oracle.UPDATER_ROLE(), address(this));
        oracle.setRate(R, "9013.90.20.00", 1600);
        feed = new TariffFeedAdapter(address(oracle), SRC);
    }

    function test_InterfaceId() public view {
        bytes4 id = type(ITariffFeed).interfaceId;
        assertEq(id, bytes4(0x89f00515)); // TFS-1 ERC-165 id, documented in docs/TFS-1.md
        assertEq(
            id,
            ITariffFeed.tariffKey.selector ^ ITariffFeed.tariffRate.selector ^ ITariffFeed.tariffRates.selector
                ^ ITariffFeed.tfsVersion.selector
        );
        assertTrue(feed.supportsInterface(id));
        assertTrue(feed.supportsInterface(0x01ffc9a7));
        assertFalse(feed.supportsInterface(0xffffffff));
        assertEq(feed.tfsVersion(), 1);
    }

    function test_ReadAndKey() public view {
        (uint16 bps, uint64 t, bytes32 s) = feed.tariffRate(R, "9013.90.20.00");
        assertEq(bps, 1600);
        assertEq(t, 1_800_000_000);
        assertEq(s, SRC);
        assertEq(feed.tariffKey(R, "x"), oracle.keyOf(R, "x"));
    }

    function test_UnsetReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ITariffFeed.TariffRateNotFound.selector, oracle.keyOf(R, "nope")));
        feed.tariffRate(R, "nope");
    }

    function test_Batch() public view {
        string[] memory r = new string[](2);
        string[] memory h = new string[](2);
        (r[0], r[1], h[0], h[1]) = (R, R, "9013.90.20.00", "nope");
        ITariffFeed.TariffRate[] memory out = feed.tariffRates(r, h);
        assertTrue(out[0].exists);
        assertEq(out[0].bps, 1600);
        assertFalse(out[1].exists);
        assertEq(out[1].bps, 0);
    }

    function test_BatchLengthMismatch() public {
        vm.expectRevert(TariffFeedAdapter.LengthMismatch.selector);
        feed.tariffRates(new string[](1), new string[](2));
    }

    function test_AdapterTracksUpdates() public {
        vm.warp(1_800_000_100);
        oracle.setRate(R, "9013.90.20.00", 1500);
        (uint16 bps, uint64 t,) = feed.tariffRate(R, "9013.90.20.00");
        assertEq(bps, 1500);
        assertEq(t, 1_800_000_100);
    }

    function test_RejectsNonContractSource() public {
        vm.expectRevert(TariffFeedAdapter.ZeroSource.selector);
        new TariffFeedAdapter(address(0xBEEF), SRC);
    }

    // ---------- example consumer ----------
    function test_CalculatorQuotes() public {
        TariffFeeCalculator c = new TariffFeeCalculator(address(feed), 365 days);
        (uint256 duty, uint16 bps) = c.quote(R, "9013.90.20.00", 1_000e6); // 1,000 USDC
        assertEq(bps, 1600);
        assertEq(duty, 160e6);
    }

    function test_CalculatorRejectsStale() public {
        TariffFeeCalculator c = new TariffFeeCalculator(address(feed), 1 days);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(abi.encodeWithSelector(TariffFeeCalculator.StaleRate.selector, uint64(1_800_000_000), uint64(1 days)));
        c.quote(R, "9013.90.20.00", 1e18);
    }

    function test_CalculatorRejectsUnset() public {
        TariffFeeCalculator c = new TariffFeeCalculator(address(feed), 1 days);
        vm.expectRevert();
        c.quote(R, "nope", 1e18);
    }

    function test_CalculatorRejectsNonFeed() public {
        // the raw oracle implements ERC-165 but not TFS-1
        vm.expectRevert(abi.encodeWithSelector(TariffFeeCalculator.NotATariffFeed.selector, address(oracle)));
        new TariffFeeCalculator(address(oracle), 1 days);
        vm.expectRevert(abi.encodeWithSelector(TariffFeeCalculator.NotATariffFeed.selector, address(0xBEEF)));
        new TariffFeeCalculator(address(0xBEEF), 1 days);
    }
}

/// Fork test against the live mainnet oracle. Runs only when MAINNET_RPC_URL is set.
contract TariffFeedForkTest is Test {
    address constant LIVE = 0x05D05690425C79a9367c3Ac626F67D148e53Bc6a;

    function test_Fork_AdapterOverLiveOracle() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        TariffFeedAdapter feed = new TariffFeedAdapter(LIVE, bytes32("USITC-HTS"));
        (uint16 bps, uint64 t, bytes32 s) = feed.tariffRate("ANY->US", "9013.90.20.00");
        assertEq(bps, 1600);
        assertGt(t, 0);
        assertEq(s, bytes32("USITC-HTS"));
        (bps,,) = feed.tariffRate("ANY->US", "9005.80.40");
        assertEq(bps, 800);
        TariffFeeCalculator c = new TariffFeeCalculator(address(feed), 400 days);
        (uint256 duty,) = c.quote("ANY->US", "9005.80.40", 10_000e6);
        assertEq(duty, 800e6);
    }
}

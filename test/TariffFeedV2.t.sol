// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {TariffFeedV2} from "../src/TariffFeedV2.sol";
import {ITariffFeed} from "../src/interfaces/ITariffFeed.sol";
import {ITariffFeedSpecific} from "../src/interfaces/ITariffFeedSpecific.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract TariffFeedV2Test is Test {
    TariffFeedV2 feed;
    address admin = address(0xA11CE);
    bytes32 constant SRC = bytes32("USITC-HTS");
    string constant R = "ANY->US";

    function setUp() public {
        feed = new TariffFeedV2(admin, SRC);
        vm.warp(1_790_000_000);
    }

    function _r(ITariffFeedSpecific.RateType t, uint32 bps, uint64 amt, bytes16 unit, bytes3 cur)
        internal
        pure
        returns (ITariffFeedSpecific.TariffRateV2 memory r)
    {
        r.rateType = t;
        r.bps = bps;
        r.amountMicro = amt;
        r.unit = unit;
        r.currency = cur;
    }

    function _set1(string memory hs, ITariffFeedSpecific.TariffRateV2 memory r) internal {
        string[] memory a = new string[](1);
        string[] memory b = new string[](1);
        ITariffFeedSpecific.TariffRateV2[] memory c = new ITariffFeedSpecific.TariffRateV2[](1);
        a[0] = R;
        b[0] = hs;
        c[0] = r;
        vm.prank(admin);
        feed.setRatesV2(a, b, c);
    }

    function test_interfaces() public view {
        assertTrue(feed.supportsInterface(type(ITariffFeed).interfaceId));
        assertTrue(feed.supportsInterface(type(ITariffFeedSpecific).interfaceId));
        assertTrue(feed.supportsInterface(type(IERC165).interfaceId));
        assertEq(type(ITariffFeed).interfaceId, bytes4(0x89f00515));
        assertEq(feed.tfsVersion(), 1);
        console.logBytes4(type(ITariffFeedSpecific).interfaceId);
    }

    function test_adValoremVisibleToBoth() public {
        _set1("8703.80.00", _r(ITariffFeedSpecific.RateType.AdValorem, 250, 0, 0, 0));
        (uint16 bps, uint64 t, bytes32 sid) = feed.tariffRate(R, "8703.80.00");
        assertEq(bps, 250);
        assertEq(t, block.timestamp);
        assertEq(sid, SRC);
        ITariffFeedSpecific.TariffRateV2 memory r = feed.tariffRateV2(R, "8703.80.00");
        assertEq(r.bps, 250);
        assertTrue(r.exists);
    }

    function test_specificHiddenFromTfs1() public {
        _set1("0102.29.40", _r(ITariffFeedSpecific.RateType.Specific, 0, 10_000, bytes16("kg"), bytes3("USD")));
        bytes32 k = feed.tariffKey(R, "0102.29.40");
        vm.expectRevert(abi.encodeWithSelector(TariffFeedV2.TariffRateNotAdValorem.selector, k));
        feed.tariffRate(R, "0102.29.40");
        string[] memory a = new string[](1);
        string[] memory b = new string[](1);
        a[0] = R;
        b[0] = "0102.29.40";
        assertFalse(feed.tariffRates(a, b)[0].exists);
        ITariffFeedSpecific.TariffRateV2 memory r = feed.tariffRatesV2(a, b)[0];
        assertTrue(r.exists);
        assertEq(r.amountMicro, 10_000);
        assertEq(r.unit, bytes16("kg"));
        assertEq(r.currency, bytes3("USD"));
    }

    function test_compoundAndOver100() public {
        _set1("0402.29.50.00", _r(ITariffFeedSpecific.RateType.Compound, 1490, 1_104_000, bytes16("kg"), bytes3("USD")));
        ITariffFeedSpecific.TariffRateV2 memory r = feed.tariffRateV2(R, "0402.29.50.00");
        assertEq(uint8(r.rateType), 3);
        assertEq(r.bps, 1490);
        _set1("2401.10.63", _r(ITariffFeedSpecific.RateType.AdValorem, 35_000, 0, 0, 0));
        vm.expectRevert();
        feed.tariffRate(R, "2401.10.63");
        assertEq(feed.tariffRateV2(R, "2401.10.63").bps, 35_000);
    }

    function test_unsetReverts() public {
        bytes32 k = feed.tariffKey(R, "0000.00");
        vm.expectRevert(abi.encodeWithSelector(ITariffFeed.TariffRateNotFound.selector, k));
        feed.tariffRateV2(R, "0000.00");
        vm.expectRevert(abi.encodeWithSelector(ITariffFeed.TariffRateNotFound.selector, k));
        feed.tariffRate(R, "0000.00");
    }

    function test_badRateShapes() public {
        vm.expectRevert(TariffFeedV2.BadRate.selector);
        _set1("x", _r(ITariffFeedSpecific.RateType.Free, 5, 0, 0, 0));
        vm.expectRevert(TariffFeedV2.BadRate.selector);
        _set1("x", _r(ITariffFeedSpecific.RateType.Specific, 0, 5, 0, bytes3("USD")));
        vm.expectRevert(TariffFeedV2.BadRate.selector);
        _set1("x", _r(ITariffFeedSpecific.RateType.AdValorem, 5, 1, bytes16("kg"), bytes3("USD")));
    }

    function test_onlyUpdater() public {
        string[] memory a = new string[](0);
        ITariffFeedSpecific.TariffRateV2[] memory c = new ITariffFeedSpecific.TariffRateV2[](0);
        vm.expectRevert();
        feed.setRatesV2(a, a, c);
        vm.expectRevert();
        feed.publishRoot(bytes32(uint256(1)), 1, "r", "u");
    }

    // ------------------------------------------------------------ Merkle (vectors from scripts/hts_merkle.py)

    function _leaf(string memory j, uint256 i)
        internal
        pure
        returns (TariffFeedV2.RateLeaf memory l, bytes32[] memory pr, bytes32 lh)
    {
        string memory p = string.concat(".vectors[", vm.toString(i), "]");
        l.route = vm.parseJsonString(j, string.concat(p, ".route"));
        l.hsCode = vm.parseJsonString(j, string.concat(p, ".hsCode"));
        l.rateType = ITariffFeedSpecific.RateType(vm.parseJsonUint(j, string.concat(p, ".rateType")));
        l.bps = uint32(vm.parseJsonUint(j, string.concat(p, ".bps")));
        l.amountMicro = uint64(vm.parseJsonUint(j, string.concat(p, ".amountMicro")));
        l.unit = bytes16(bytes(vm.parseJsonString(j, string.concat(p, ".unit"))));
        l.currency = bytes3(bytes(vm.parseJsonString(j, string.concat(p, ".currency"))));
        pr = vm.parseJsonBytes32Array(j, string.concat(p, ".proof"));
        lh = vm.parseJsonBytes32(j, string.concat(p, ".leafHash"));
    }

    function test_merkleVectorsFromPython() public {
        string memory j = vm.readFile("data/hts/merkle/vectors.json");
        bytes32 root = vm.parseJsonBytes32(j, ".root");
        uint256 n = vm.parseJsonUint(vm.readFile("data/hts/merkle/root.json"), ".leafCount");
        TariffFeedV2.RateLeaf memory l0;
        bytes32[] memory p0;
        bytes32 h;
        (l0,,) = _leaf(j, 0);
        assertFalse(feed.verifyRate(l0, new bytes32[](0))); // no root yet
        vm.prank(admin);
        feed.publishRoot(root, uint32(n), "2026HTSRev21", "data/hts");
        uint256 published = block.timestamp;
        for (uint256 i; i < 9; ++i) {
            (TariffFeedV2.RateLeaf memory l, bytes32[] memory pr, bytes32 lh) = _leaf(j, i);
            assertEq(feed.leafHash(l), lh, "leaf encoding matches python");
            assertTrue(feed.verifyRate(l, pr), l.hsCode);
            if (i == 4) (l0, p0, h) = (l, pr, lh);
        }
        // tamper: change the rate -> invalid
        (TariffFeedV2.RateLeaf memory bad,,) = _leaf(j, 4); // fresh copy (memory structs alias)
        bad.bps += 1;
        assertFalse(feed.verifyRate(bad, p0));
        vm.expectRevert(TariffFeedV2.InvalidProof.selector);
        feed.proveRate(bad, p0);
        // anyone can materialize; lastUpdated = root publish time
        vm.warp(published + 1 days);
        vm.prank(address(0xBEEF));
        uint256 g = gasleft();
        feed.proveRate(l0, p0);
        console.log("proveRate gas (compound, depth 16):", g - gasleft());
        ITariffFeedSpecific.TariffRateV2 memory r = feed.tariffRateV2(l0.route, l0.hsCode);
        assertEq(r.lastUpdated, published);
        assertEq(r.amountMicro, l0.amountMicro);
    }

    function test_proveNeedsRoot() public {
        TariffFeedV2.RateLeaf memory l;
        vm.expectRevert(TariffFeedV2.NoRoot.selector);
        feed.proveRate(l, new bytes32[](0));
    }

    /// Gas numbers for docs/gas-plan.md
    function test_gasBatch100() public {
        uint256 n = 100;
        string[] memory a = new string[](n);
        string[] memory b = new string[](n);
        ITariffFeedSpecific.TariffRateV2[] memory c = new ITariffFeedSpecific.TariffRateV2[](n);
        for (uint256 i; i < n; ++i) {
            a[i] = R;
            b[i] = string.concat("0101.21.", vm.toString(10 + i), ".00");
            c[i] = _r(ITariffFeedSpecific.RateType.AdValorem, uint32(100 + i), 0, 0, 0);
        }
        vm.prank(admin);
        uint256 g = gasleft();
        feed.setRatesV2(a, b, c);
        console.log("setRatesV2 x100 execution gas:", g - gasleft());
        vm.prank(admin);
        g = gasleft();
        feed.publishRoot(
            keccak256("r"), 47574, "2026HTSRev21", "https://github.com/fitzyracing1/space-money/tree/main/data/hts"
        );
        console.log("publishRoot execution gas:", g - gasleft());
    }
}

# Integrating the tariff feed

The live feed is the mainnet **TariffOracle** at
[`0x05D05690425C79a9367c3Ac626F67D148e53Bc6a`](https://etherscan.io/address/0x05D05690425C79a9367c3Ac626F67D148e53Bc6a#readContract).
It publishes USITC HTS "General" (MFN) ad-valorem rates for the route `ANY->US`. You can browse the rates at
[feed.html](https://fitzyracing1.github.io/space-money/feed.html). The standard is described in [TFS-1](TFS-1.md).

```
getRate(string route, string hsCode) view returns (uint16 bps, uint64 updatedAt)   // reverts RateNotFound(key) if unset
event RateSet(bytes32 indexed key, string route, string hsCode, uint16 bps)
event RateRemoved(bytes32 indexed key)
```

`bps` is basis points: 800 means 8%. `0` means duty-free. A revert means the pair is unknown, so never read it as 0.

## Solidity

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITariffOracle {
    function getRate(string calldata route, string calldata hsCode) external view returns (uint16 bps, uint64 updatedAt);
}

contract DutyQuote {
    ITariffOracle constant ORACLE = ITariffOracle(0x05D05690425C79a9367c3Ac626F67D148e53Bc6a);
    uint64 constant MAX_AGE = 400 days;   // see TFS-1 staleness guidance

    error Stale(uint64 updatedAt);

    /// duty on `value` (any token units, e.g. USDC 6 decimals)
    function duty(string calldata hsCode, uint256 value) external view returns (uint256) {
        (uint16 bps, uint64 t) = ORACLE.getRate("ANY->US", hsCode);   // reverts if unknown
        if (t > block.timestamp || block.timestamp - t > MAX_AGE) revert Stale(t);
        return value * bps / 10_000;
    }
}
```

When the TFS-1 adapter is live, code against `ITariffFeed` instead
(`src/interfaces/ITariffFeed.sol`). Check `supportsInterface(0x89f00515)` in your constructor and use
`tariffRate` / `tariffRates`. [`src/examples/TariffFeeCalculator.sol`](../src/examples/TariffFeeCalculator.sol)
is a full example, tested in `test/TariffFeed.t.sol`, including a fork test against the live oracle:

```bash
MAINNET_RPC_URL=https://ethereum-rpc.publicnode.com forge test --mt test_Fork
```

## ethers.js (v6)

```js
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
const oracle = new ethers.Contract("0x05D05690425C79a9367c3Ac626F67D148e53Bc6a", [
  "function getRate(string,string) view returns (uint16 bps, uint64 updatedAt)",
  "event RateSet(bytes32 indexed key, string route, string hsCode, uint16 bps)",
], provider);

// one rate
const [bps, updatedAt] = await oracle.getRate("ANY->US", "9005.80.40");
console.log(`${Number(bps) / 100}% (updated ${new Date(Number(updatedAt) * 1000).toISOString()})`);

// unknown pair -> revert
try { await oracle.getRate("ANY->US", "0000.00.00"); } catch (e) { console.log("not published"); }

// list every published code (oracle deployed at block 26253241)
const logs = await oracle.queryFilter(oracle.filters.RateSet(), 26253241);
const codes = [...new Set(logs.map((l) => l.args.hsCode))];

// watch for updates
oracle.on(oracle.filters.RateSet(), (key, route, hsCode, bps) => console.log("updated", route, hsCode, bps));
```

## cast

```bash
cast call 0x05D05690425C79a9367c3Ac626F67D148e53Bc6a "getRate(string,string)(uint16,uint64)" \
  "ANY->US" "9005.80.40" --rpc-url https://ethereum-rpc.publicnode.com
```

## How rates get updated

`scripts/update_feed.py` compares current USITC HTS rates with what's on-chain and prints **only the changed
rates** as an unsigned `setRates` transaction (JSON or raw calldata). It never signs or sends anything. The
oracle's updater (the admin wallet) reviews the output and sends it. See the README section "Use the tariff feed".

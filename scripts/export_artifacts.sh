#!/usr/bin/env bash
# Export ABI + creation bytecode from Foundry out/ for the in-browser deploy page.
set -euo pipefail
cd "$(dirname "$0")/.."
forge build -q
mkdir -p site/artifacts
for c in SpaceToken TariffOracle Reserve TariffRouter TariffFeedAdapter SpaceLog; do
  jq '{contractName:"'$c'",abi:.abi,bytecode:.bytecode.object}' out/$c.sol/$c.json > site/artifacts/$c.json
done

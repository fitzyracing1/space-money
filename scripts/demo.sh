#!/usr/bin/env bash
# End-to-end LOCAL demo on anvil. No testnet, no mainnet, no real funds.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
RPC_URL=http://127.0.0.1:8545
anvil --silent --port 8545 & ANVIL=$!
trap 'kill $ANVIL 2>/dev/null' EXIT
sleep 2

# Anvil's well-known public dev accounts #0 (admin/updater) and #1 (shipper). Local only; never reuse.
ADMIN_PK=$(cast wallet private-key "test test test test test test test test test test test junk" 0)
SHIPPER_PK=$(cast wallet private-key "test test test test test test test test test test test junk" 1)
SHIPPER=$(cast wallet address --private-key "$SHIPPER_PK")
TREASURY=0x000000000000000000000000000000000000dEaD

echo "== deploy =="
OUT=$(TREASURY=$TREASURY forge script script/Deploy.s.sol --rpc-url $RPC_URL --private-key "$ADMIN_PK" --broadcast 2>&1)
for v in TOKEN ORACLE RESERVE ROUTER; do
  export $v=$(echo "$OUT" | grep -oE "$v=0x[0-9a-fA-F]{40}" | cut -d= -f2); echo "$v=${!v}"
done

echo "== feed oracle (USITC HTS) =="
ORACLE=$ORACLE RPC_URL=$RPC_URL PRIVATE_KEY=$ADMIN_PK python3 scripts/feed_oracle.py

send() { cast send --rpc-url $RPC_URL "$@" >/dev/null; }
bal() { cast to-unit $(cast call --rpc-url $RPC_URL $TOKEN "balanceOf(address)(uint256)" $1 | awk '{print $1}') ether; }

echo "== mint test SPACE to shipper, approve router =="
send --private-key "$ADMIN_PK" $TOKEN "mint(address,uint256)" $SHIPPER $(cast to-wei 100000)
send --private-key "$SHIPPER_PK" $TOKEN "approve(address,uint256)" $ROUTER $(cast max-uint)

HS=9005.80.40; VALUE=$(cast to-wei 50000)
echo "== quote: optical telescopes HTS $HS, declared value 50000 SPACE =="
cast call --rpc-url $RPC_URL $ROUTER "quote(string,string,uint256)(uint256,uint256,uint256)" "ANY->US" $HS $VALUE
SHIP=$(cast keccak "demo-shipment-001")
send --private-key "$SHIPPER_PK" $ROUTER "payTariff(bytes32,string,string,uint256,uint256)" $SHIP "ANY->US" $HS $VALUE $(cast max-uint)
echo "== after payTariff =="
echo "shipper  SPACE: $(bal $SHIPPER)"
echo "reserve  SPACE: $(bal $RESERVE)"
echo "treasury SPACE: $(bal $TREASURY)"
echo "paid[$SHIP] = $(cast call --rpc-url $RPC_URL $ROUTER 'paid(bytes32)(bool)' $SHIP)"
echo "demo complete"

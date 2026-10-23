# Mainnet deployment checklist (NOT deployed)

> space-money is a **prototype**. Nothing in this repo has been deployed to Ethereum mainnet, and no mainnet key has been created or funded. This file is a checklist for Joshua Almeida to work through **himself**, only after every gate below is cleared.

## 1. Legal review (blocking)
- [ ] Engage a **securities lawyer** before any sale, distribution, airdrop, listing or marketing of SPACE. A token "backed" by a fee reserve may be treated as a security, a stored-value or money-transmission product, or a stablecoin-like instrument, depending on the jurisdiction.
- [ ] Get advice on money transmission / MSB licensing, sanctions screening (OFAC) and customs/tariff-collection rules. Paying real government tariffs in a private token is not something customs authorities accept today.
- [ ] Get written sign-off before mainnet. **No token sale without counsel.**

## 2. Security audit (strongly recommended)
- [ ] Get an independent audit of `src/` and `script/DeployMainnet.s.sol` by a reputable firm. The contracts are small (4 contracts, roughly 250 lines), so budget for a short engagement.
- [ ] Run static analysis (Slither, Aderyn) and fix or document every finding.
- [ ] Freeze the commit hash that was audited, and deploy exactly that commit.

## 3. Gas cost estimate
Measured on Sepolia for the full flow: 4 deploys + role grants + feeding 25 rates + one demo payment ≈ **39.35M gas** (35.70M of it deploy + grants). Mainnet may be cheaper if it does not carry Sepolia's higher contract-creation pricing, so treat this as an upper bound.

Snapshot taken on **2026-10-22 23:52 EDT**:
- Gas price: **0.0377 gwei** (`eth_gasPrice` from the public RPC `https://ethereum-rpc.publicnode.com`, with a base fee of about 0.0377 gwei).
- ETH price: **$2,410.47** (CoinGecko simple price API, `api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`).

| Gas price | ETH for 39.35M gas | USD at $2,410.47 |
|---|---|---|
| 0.0377 gwei (snapshot) | 0.00148 ETH | ≈ **$3.58** |
| 1 gwei | 0.0394 ETH | ≈ $95 |
| 5 gwei | 0.197 ETH | ≈ $474 |
| 20 gwei (busy network) | 0.787 ETH | ≈ $1,897 |

Fund the deployer with the snapshot estimate × 3 plus a buffer, and re-check the gas price right before deploying. Safe deployment and Safe transactions cost extra.

## 4. Safe multisig setup
- [ ] Create a Safe at https://app.safe.global on Ethereum mainnet, with at least a **2-of-3** threshold (3-of-5 preferred). Use hardware-wallet signers held by different people/devices.
- [ ] Record the Safe address and confirm it on Etherscan as a contract. `DeployMainnet` refuses a `SAFE` that has no code.
- [ ] The Safe receives `DEFAULT_ADMIN_ROLE` on all 4 contracts, plus `MINTER_ROLE`, `CONFIG_ROLE` and `WITHDRAWER_ROLE`. It is also the default treasury.
- [ ] Optionally put an OpenZeppelin `TimelockController` between the Safe and the admin roles, so config/withdrawal changes are delayed and visible.

## 5. Oracle updater key handling
- [ ] `ORACLE_UPDATER` is a **separate** address that holds only `UPDATER_ROLE`. It cannot mint, withdraw or reconfigure.
- [ ] Keep it in a hardware wallet or a managed signer (KMS / HSM / Defender Relayer), never in a plaintext `.env` on a shared machine.
- [ ] Hold only enough ETH on it for rate updates.
- [ ] If it is compromised: the Safe revokes it with `TariffOracle.revokeRole(UPDATER_ROLE, updater)` and grants a new one. Payers are protected from surprise rate hikes by `payTariff`'s `maxFee`.
- [ ] Before mainnet, add monitoring and alerts on `RateSet` events.

## 6. Exact commands (Joshua runs these himself)
```bash
# 0. Use the audited commit
git clone --recursive https://github.com/fitzyracing1/space-money && cd space-money
git checkout <AUDITED_COMMIT>
forge test

# 1. Use a fresh hardware-wallet deployer. Do not paste a private key into the shell.
export ETH_RPC_URL=https://ethereum-rpc.publicnode.com     # or your own provider
cast chain-id                                               # must print 1
export SAFE=0x<your Safe>
export ORACLE_UPDATER=0x<updater address>
export TREASURY=$SAFE                                       # optional; defaults to SAFE
export RESERVE_SHARE_BPS=2000                               # 20%

# 2. Dry run (simulation only, nothing is sent)
CONFIRM_MAINNET=yes forge script script/DeployMainnet.s.sol --rpc-url $ETH_RPC_URL --ledger --sender 0x<deployer>

# 3. Real deploy (only after legal + audit sign-off)
CONFIRM_MAINNET=yes forge script script/DeployMainnet.s.sol --rpc-url $ETH_RPC_URL \
  --ledger --sender 0x<deployer> --broadcast --slow --verify --etherscan-api-key $ETHERSCAN_API_KEY

# 4. Check the hand-off (each should print true / false as shown)
ADMIN=0x0000000000000000000000000000000000000000000000000000000000000000
for C in $TOKEN $ORACLE $RESERVE $ROUTER; do
  cast call $C "hasRole(bytes32,address)(bool)" $ADMIN $SAFE        # true
  cast call $C "hasRole(bytes32,address)(bool)" $ADMIN 0x<deployer> # false
done

# 5. Load rates from the updater key
ORACLE=$ORACLE RPC_URL=$ETH_RPC_URL PRIVATE_KEY=... python3 scripts/feed_oracle.py   # prefer a signer that doesn't need a raw key
```
`DeployMainnet.s.sol` reverts unless the chain id is 1, `CONFIRM_MAINNET=yes`, `SAFE` is a deployed contract and `ORACLE_UPDATER` is set. After granting the roles to the Safe (and `UPDATER_ROLE` to the updater), the deployer renounces `DEFAULT_ADMIN_ROLE` on all 4 contracts and holds no roles. This is covered by `test/DeployMainnet.t.sol`.

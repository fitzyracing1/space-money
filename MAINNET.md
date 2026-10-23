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

**Update 2026-10-23 00:52 EDT.** The full phone-page flow (4 deploys + 4 role grants + feeding 25 rates) used **6,160,667 gas** on a local anvil fork of mainnet. Sepolia's ~39M includes Sepolia's much higher contract-creation pricing. At **0.0390 gwei** (`eth_gasPrice`, publicnode mainnet RPC) and **$2,394.42/ETH** (CoinGecko), that is **≈ 0.00024 ETH ≈ $0.58**. The 39.35M upper bound would be ≈ 0.00153 ETH ≈ $3.67. At 1 gwei the flow costs ≈ 0.0062 ETH ≈ $15; at 10 gwei ≈ 0.062 ETH ≈ $148. Keep **≥ 0.01 ETH** in the wallet as a buffer. The deploy page shows the live estimate before each tap.

### Earlier estimate
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

## 4. Admin: single wallet now, Safe later
**Chosen setup:** the admin is Joshua's own wallet (Coinbase / Base Wallet app, an EOA) on Ethereum mainnet. No Safe.

> ⚠️ **Single-key risk.** One phone wallet holds `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`, `CONFIG_ROLE`, `WITHDRAWER_ROLE`, `UPDATER_ROLE` and is the treasury. If that key or its recovery phrase leaks, an attacker can mint unlimited SPACE, redirect fees and drain the reserve. If it is lost, admin is gone for good. Protect the recovery phrase offline, and turn on the app's passcode and biometrics.

**Moving to a Safe later** (no redeploy needed). From the admin wallet, on each of the 4 contracts:
1. `grantRole(0x00…00, SAFE)` plus the operational roles (`MINTER_ROLE`, `CONFIG_ROLE`, `WITHDRAWER_ROLE`, and optionally `UPDATER_ROLE`).
2. Check `hasRole` for the Safe.
3. `renounceRole(<each role>, yourWallet)`.
4. `TariffRouter.setDestinations(reserve, SAFE)` to move the treasury.

`script/DeployMainnet.s.sol` takes `ADMIN=<EOA or Safe>`, and there is no has-code check. If the deployer is not `ADMIN`, it renounces its admin roles after the hand-off. If deployer == `ADMIN` (deploying from the admin wallet itself), it keeps them.

### Two ways to deploy
- **A. Phone (chosen):** open https://fitzyracing1.github.io/space-money/deploy.html in the Coinbase / Base Wallet **in-app browser**. It deploys the 4 contracts and grants all roles to the connected wallet, with one tap per transaction and the gas and live cost shown before each, then optionally feeds the 25 HTS rates. It ends with Etherscan links and a copyable `deployments/mainnet.json`.
- **B. Laptop + forge:** section 7 below.

## 5. Safe multisig setup (optional / later)
- [ ] Create a Safe at https://app.safe.global on Ethereum mainnet, with at least a **2-of-3** threshold (3-of-5 preferred). Use hardware-wallet signers held by different people/devices.
- [ ] Record the Safe address and confirm it on Etherscan as a contract.
- [ ] The Safe receives `DEFAULT_ADMIN_ROLE` on all 4 contracts, plus `MINTER_ROLE`, `CONFIG_ROLE` and `WITHDRAWER_ROLE`. It is also the default treasury.
- [ ] Optionally put an OpenZeppelin `TimelockController` between the Safe and the admin roles, so config/withdrawal changes are delayed and visible.

## 6. Oracle updater key handling
- [ ] With the phone setup, the updater is the admin wallet itself (simplest, but it widens the single-key risk). Better: later, grant `UPDATER_ROLE` to a **separate** low-value address that holds only that role, and revoke it from the admin wallet.
- [ ] Keep it in a hardware wallet or a managed signer (KMS / HSM / Defender Relayer), never in a plaintext `.env` on a shared machine.
- [ ] Hold only enough ETH on it for rate updates.
- [ ] If it is compromised: the Safe revokes it with `TariffOracle.revokeRole(UPDATER_ROLE, updater)` and grants a new one. Payers are protected from surprise rate hikes by `payTariff`'s `maxFee`.
- [ ] Before mainnet, add monitoring and alerts on `RateSet` events.

## 7. Exact commands, forge path (Joshua runs these himself)
```bash
# 0. Use the audited commit
git clone --recursive https://github.com/fitzyracing1/space-money && cd space-money
git checkout <AUDITED_COMMIT>
forge test

# 1. Use a fresh hardware-wallet deployer. Do not paste a private key into the shell.
export ETH_RPC_URL=https://ethereum-rpc.publicnode.com     # or your own provider
cast chain-id                                               # must print 1
export ADMIN=0x<your wallet or Safe>
export ORACLE_UPDATER=$ADMIN                                # optional; defaults to ADMIN
export TREASURY=$ADMIN                                      # optional; defaults to ADMIN
export RESERVE_SHARE_BPS=2000                               # 20%

# 2. Dry run (simulation only, nothing is sent)
CONFIRM_MAINNET=yes forge script script/DeployMainnet.s.sol --rpc-url $ETH_RPC_URL --ledger --sender 0x<deployer>

# 3. Real deploy (only after legal + audit sign-off)
CONFIRM_MAINNET=yes forge script script/DeployMainnet.s.sol --rpc-url $ETH_RPC_URL \
  --ledger --sender 0x<deployer> --broadcast --slow --verify --etherscan-api-key $ETHERSCAN_API_KEY

# 4. Check the hand-off (each should print true / false as shown)
ADMIN_ROLE=0x0000000000000000000000000000000000000000000000000000000000000000
for C in $TOKEN $ORACLE $RESERVE $ROUTER; do
  cast call $C "hasRole(bytes32,address)(bool)" $ADMIN_ROLE $ADMIN  # true
  cast call $C "hasRole(bytes32,address)(bool)" $ADMIN_ROLE 0x<deployer> # false (unless deployer == ADMIN)
done

# 5. Load rates from the updater key
ORACLE=$ORACLE RPC_URL=$ETH_RPC_URL PRIVATE_KEY=... python3 scripts/feed_oracle.py   # prefer a signer that doesn't need a raw key
```
`DeployMainnet.s.sol` reverts unless the chain id is 1, `CONFIRM_MAINNET=yes` and `ADMIN` is set (EOA or Safe). After granting the roles to `ADMIN` (and `UPDATER_ROLE` to the updater), a separate deployer renounces `DEFAULT_ADMIN_ROLE` on all 4 contracts. This is covered by `test/DeployMainnet.t.sol`.

## Phone deploy uses CREATE2 (smart-wallet safe)

`site/deploy.html` never sends a contract-creation transaction. Every contract is created through the
canonical deterministic deployer `0x4e59b44847b379578588920cA78FbF26c0B4956C` with
`data = salt ++ initcode`, where `salt = keccak256(abi.encode(admin, "space-money/v1", contractName))`.
This works for EOAs and for Coinbase Smart Wallet / EIP-7702 accounts, which cannot send creation txs.
Addresses are predicted with `getCreate2Address` and shown before sending; confirmation is by polling
`eth_getCode` / role state (a smart wallet returns a UserOp hash, not a tx hash). Re-running is idempotent:
anything already on-chain is skipped. All constructors take `admin` explicitly, so the factory never holds a
role (checked by `test/Create2Deploy.t.sol` and by the page's final role check).

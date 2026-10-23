# Security Policy

space-money is an **unaudited prototype** for local/testnet use only. Do not deploy to mainnet or hold real value in it.

## Reporting a vulnerability
Please use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository. Do not open public issues for security problems.

## Known trust assumptions
- `UPDATER_ROLE` on `TariffOracle` can set any rate up to 100%. Payers should pass a tight `maxFee` to `payTariff`.
- `DEFAULT_ADMIN_ROLE` holders can grant every role, mint SPACE (via `MINTER_ROLE`), redirect fees (`CONFIG_ROLE`) and withdraw the reserve (`WITHDRAWER_ROLE`). In anything beyond a demo these should be a multisig/timelock.
- Tariff data is pulled from a public source by an off-chain feeder; it is not verified on-chain.

## Secrets
Never commit private keys. Scripts read keys only from environment variables and never print them. The demo uses Anvil's publicly-known dev accounts, which must never be used on a real network.

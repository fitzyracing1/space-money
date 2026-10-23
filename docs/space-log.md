# SpaceLog (design + contract) — NOT DEPLOYED

`src/SpaceLog.sol` is tested locally only (`forge test --match-contract SpaceLogTest`). It has no mainnet or testnet deployment.

## What an entry records
| Field | Meaning |
|---|---|
| description, hsCode, origin | the item, its HS code and its country of origin |
| route | launch/route, e.g. "SpaceX Transporter SSO" |
| declaredValue | the user's declared value |
| counterfactual US / EU / UK | duty + import VAT the item *would* pay if imported into each destination, from the landed-cost tool (`landed_cost` MCP tool / `site/landed.html`). A `*Known=false` flag means "check source". Never guess a rate. |
| attestation | **required**: `LicenseHeld` or `NotRequired`. This is the user's own self-attestation. |
| likelyControlled | a text-level hint from the `export_control_flag(hs)` tool (e.g. HS 8802 spacecraft → USML XV / ECCN 9A515). It is a hint, not a classification. |
| feePaid | optional SPACE logging fee (`logFee`, default 0), sent to the treasury |
| creditedRepos | the GitHub repos used ("owner/name"; at most 20). Matching is case-insensitive. |

## Optional repo payout split
- `settleSale(id, seller, amount)`: the buyer pays `amount` SPACE through the contract. `payoutBps` (default **0**, capped at 20%) of that is split equally across the entry's credited repos.
- Only repos that are **registered and opted in** receive funds. An admin (`REGISTRAR_ROLE`) calls `registerRepo(repo, wallet)` after off-chain verification that the repo opted in, for example a file committed in the repo that names the wallet.
- Unregistered or opted-out repos get **credit only**: a `RepoCredited(..., paid=false)` event and no funds. Their share stays with the seller.
- A repo's registered wallet (or the registrar) can `optOut` at any time.

## Legal notes (not legal advice)
- **No tariff currently applies to sales in orbit**, because space is not a customs territory. The counterfactual fields are informational.
- Export controls apply on Earth before launch: ITAR (USML Cat. XV), EAR (CCL, e.g. 9A515), and other countries' equivalents. Launch and spectrum licences also apply (FAA/FCC or national). The attestation is the user's claim. The contract does not verify it.
- Import duty/VAT can still apply when hardware is shipped into the launch country, and to anything returned to Earth.
- Paying in SPACE or any crypto does not change customs valuation or duty.
- Launch prices come only from public posted sources (see `data/landed/landed.json` → `space`).

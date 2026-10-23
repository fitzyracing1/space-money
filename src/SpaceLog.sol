// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SpaceLog
/// @notice Log of items sent to orbit, with the counterfactual tariffs they would have paid on Earth,
///         an export-license self-attestation, an optional SPACE logging fee and credited GitHub repos.
///         Optional: when a sale is settled in SPACE through this contract, a configurable slice is split
///         across credited repos that are registered (admin-verified) and opted in. Unregistered repos get
///         credit only (an event), never funds.
/// @dev NOT DEPLOYED. Testnet/local only. Not legal advice: no tariff currently applies to sales in orbit,
///      but export controls (ITAR/EAR) apply on Earth before launch. The attestation is the user's own claim.
contract SpaceLog is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    uint16 public constant MAX_PAYOUT_BPS = 2000; // 20% cap
    uint256 public constant MAX_REPOS = 20;

    enum ExportAttestation { None, LicenseHeld, NotRequired }

    /// @dev Counterfactual amounts are in the same unit as declaredValue; `known` false = "check source".
    struct Counterfactual {
        uint256 us;
        uint256 eu;
        uint256 uk;
        bool usKnown;
        bool euKnown;
        bool ukKnown;
    }

    struct Entry {
        address logger;
        string description;
        string hsCode;
        string origin;
        string route; // launch / route, e.g. "SpaceX Transporter SSO"
        uint256 declaredValue;
        Counterfactual counterfactual;
        ExportAttestation attestation;
        bool likelyControlled; // tool's text-level ITAR/EAR flag, informational only
        uint256 feePaid;
        string[] creditedRepos; // "owner/name"
        uint64 timestamp;
    }

    struct EntryInput {
        string description;
        string hsCode;
        string origin;
        string route;
        uint256 declaredValue;
        Counterfactual counterfactual;
        ExportAttestation attestation;
        bool likelyControlled;
    }

    struct Repo {
        address wallet;
        bool optedIn;
    }

    IERC20 public immutable space;
    address public treasury;
    uint256 public logFee; // optional, 0 = free
    uint16 public payoutBps; // slice of a sale shared with registered repos

    Entry[] internal _entries;
    mapping(bytes32 => Repo) public repos; // keccak256(lowercase "owner/name") => Repo

    event Logged(uint256 indexed id, address indexed logger, string hsCode, ExportAttestation attestation,
        bool likelyControlled, uint256 feePaid);
    event RepoCredited(uint256 indexed id, string repo, bool paid, uint256 amount);
    event SaleSettled(uint256 indexed id, address indexed buyer, address indexed seller, uint256 amount,
        uint256 toRepos);
    event RepoRegistered(string repo, address wallet);
    event RepoOptedOut(string repo);
    event ConfigSet(uint256 logFee, uint16 payoutBps, address treasury);

    error AttestationRequired();
    error TooManyRepos();
    error BadEntry();
    error BadConfig();
    error NotRepoWallet();

    constructor(IERC20 space_, address admin, address treasury_) {
        if (address(space_) == address(0) || admin == address(0) || treasury_ == address(0)) revert BadConfig();
        space = space_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    // ------------------------------------------------------------------ log
    function logEntry(EntryInput calldata x, string[] calldata creditedRepos)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (x.attestation == ExportAttestation.None) revert AttestationRequired();
        if (creditedRepos.length > MAX_REPOS) revert TooManyRepos();
        uint256 fee = logFee;
        if (fee > 0) space.safeTransferFrom(msg.sender, treasury, fee);
        id = _entries.length;
        Entry storage e = _entries.push();
        e.logger = msg.sender;
        e.description = x.description;
        e.hsCode = x.hsCode;
        e.origin = x.origin;
        e.route = x.route;
        e.declaredValue = x.declaredValue;
        e.counterfactual = x.counterfactual;
        e.attestation = x.attestation;
        e.likelyControlled = x.likelyControlled;
        e.feePaid = fee;
        // forge-lint: disable-next-line(unsafe-typecast)
        e.timestamp = uint64(block.timestamp);
        for (uint256 i; i < creditedRepos.length; ++i) {
            e.creditedRepos.push(creditedRepos[i]);
            emit RepoCredited(id, creditedRepos[i], false, 0);
        }
        emit Logged(id, msg.sender, x.hsCode, x.attestation, x.likelyControlled, fee);
    }

    // ------------------------------------------------------------------ sale settlement (SPACE)
    /// @notice Buyer pays `amount` SPACE for logged item `id`. payoutBps of it is split equally across
    ///         credited repos; shares of unregistered / opted-out repos stay with the seller.
    function settleSale(uint256 id, address seller, uint256 amount) external nonReentrant {
        if (id >= _entries.length || seller == address(0) || amount == 0) revert BadEntry();
        string[] storage list = _entries[id].creditedRepos;
        uint256 slice = (amount * payoutBps) / 10_000;
        uint256 n = list.length;
        uint256 per = n == 0 ? 0 : slice / n;
        uint256 paid = 0;
        for (uint256 i; i < n; ++i) {
            Repo memory r = repos[_key(list[i])];
            bool pay = per > 0 && r.optedIn && r.wallet != address(0);
            if (pay) {
                space.safeTransferFrom(msg.sender, r.wallet, per);
                paid += per;
            }
            emit RepoCredited(id, list[i], pay, pay ? per : 0);
        }
        space.safeTransferFrom(msg.sender, seller, amount - paid);
        emit SaleSettled(id, msg.sender, seller, amount, paid);
    }

    // ------------------------------------------------------------------ repo registry
    /// @notice Admin registers a repo's payout wallet after off-chain verification that the repo opted in
    ///         (e.g. a signed file in the repo naming the wallet).
    function registerRepo(string calldata repo, address wallet) external onlyRole(REGISTRAR_ROLE) {
        if (wallet == address(0)) revert BadConfig();
        repos[_key(repo)] = Repo(wallet, true);
        emit RepoRegistered(repo, wallet);
    }

    /// @notice The registered wallet (or admin) can opt the repo out at any time.
    function optOut(string calldata repo) external {
        Repo storage r = repos[_key(repo)];
        if (msg.sender != r.wallet && !hasRole(REGISTRAR_ROLE, msg.sender)) revert NotRepoWallet();
        r.optedIn = false;
        emit RepoOptedOut(repo);
    }

    function setConfig(uint256 fee, uint16 bps, address treasury_) external onlyRole(CONFIG_ROLE) {
        if (bps > MAX_PAYOUT_BPS || treasury_ == address(0)) revert BadConfig();
        logFee = fee;
        payoutBps = bps;
        treasury = treasury_;
        emit ConfigSet(fee, bps, treasury_);
    }

    // ------------------------------------------------------------------ views
    function count() external view returns (uint256) {
        return _entries.length;
    }

    function getEntry(uint256 id) external view returns (Entry memory) {
        return _entries[id];
    }

    function repoKey(string calldata repo) external pure returns (bytes32) {
        return _key(repo);
    }

    /// @dev Case-insensitive ASCII key so "Owner/Repo" and "owner/repo" match (GitHub names are case-insensitive).
    function _key(string memory s) internal pure returns (bytes32) {
        bytes memory b = bytes(s);
        for (uint256 i; i < b.length; ++i) {
            if (b[i] >= 0x41 && b[i] <= 0x5A) b[i] = bytes1(uint8(b[i]) + 32);
        }
        return keccak256(b);
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Instance } from "@equilibria/root/attribute/Instance.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";
import { UFixed6, UFixed6Lib } from "@equilibria/root/number/types/UFixed6.sol";

import { IAccount, IMarket } from "./interfaces/IAccount.sol";
import { IController } from "./interfaces/IController.sol";
import { IVerifier } from "./interfaces/IVerifier.sol";
import { Account } from "./Account.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { MarketTransfer, MarketTransferLib } from "./types/MarketTransfer.sol";
import {
    RebalanceConfig,
    RebalanceConfigLib,
    RebalanceConfigChange,
    RebalanceConfigChangeLib
} from "./types/RebalanceConfig.sol";
import { SignerUpdate, SignerUpdateLib } from "./types/SignerUpdate.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";

/// @title Controller
/// @notice Facilitates unpermissioned actions between collateral accounts and markets
contract Controller is Instance, IController {
    // used for deterministic address creation through create2
    bytes32 constant SALT = keccak256("Perennial V2 Collateral Accounts");

    uint256 constant MAX_GROUPS_PER_OWNER = 8;
    uint256 constant MAX_MARKETS_PER_GROUP = 4;

    /// @dev USDC stablecoin address
    Token6 public USDC; // solhint-disable-line var-name-mixedcase

    /// @dev DSU address
    Token18 public DSU; // solhint-disable-line var-name-mixedcase

    /// @dev Contract used to validate messages were signed by the sender
    IVerifier public verifier;

    /// @dev DSU Reserve address
    IEmptySetReserve public reserve;

    /// @dev Mapping of allowed signers for each account owner
    /// owner => delegate => enabled flag
    mapping(address => mapping(address => bool)) public signers;

    /// @dev Mapping of rebalance configuration
    /// owner => group => market => config
    mapping(address => mapping(uint256 => mapping(address => RebalanceConfig))) config;

    /// @dev Prevents markets from being added to multiple rebalance groups
    /// owner => market => group
    mapping(address => mapping(address => uint256)) marketToGroup;

    /// @dev Allows iteration through markets in a rebalance group
    /// owner => group => markets
    mapping(address => mapping(uint256 => address[])) groupToMarkets;

    /// @inheritdoc IController
    function initialize(
        IVerifier verifier_,
        Token6 usdc_,
        Token18 dsu_,
        IEmptySetReserve reserve_
    ) external initializer(1) {
        __Instance__initialize();
        verifier = verifier_;
        USDC = usdc_;
        DSU = dsu_;
        reserve = reserve_;
    }

    /// @inheritdoc IController
    function getAccountAddress(address owner) public view returns (address) {
        // generate bytecode for an account created for the specified owner
        bytes memory bytecode = abi.encodePacked(
            type(Account).creationCode,
            abi.encode(owner),
            abi.encode(address(this)),
            abi.encode(USDC),
            abi.encode(DSU),
            abi.encode(reserve));
        // calculate the hash for that bytecode and compute the address
        return Create2.computeAddress(SALT, keccak256(bytecode));
    }

    /// @inheritdoc IController
    function deployAccount() public returns (IAccount) {
        return _createAccount(msg.sender);
    }

    /// @inheritdoc IController
    function deployAccountWithSignature(
        DeployAccount calldata deployAccount_,
        bytes calldata signature
    ) virtual external {
        _deployAccountWithSignature(deployAccount_, signature);
    }

    function _deployAccountWithSignature(
        DeployAccount calldata deployAccount_,
        bytes calldata signature
    ) internal returns (IAccount account) {
        address owner = deployAccount_.action.common.account;
        verifier.verifyDeployAccount(deployAccount_, signature);
        _ensureValidSigner(owner, deployAccount_.action.common.signer);

        // create the account
        account = _createAccount(owner);
    }

    function _createAccount(address owner) internal returns (IAccount account) {
        account = new Account{salt: SALT}(owner, address(this), USDC, DSU, reserve);
        emit AccountDeployed(owner, account);
    }

    /// @inheritdoc IController
    function marketTransferWithSignature(MarketTransfer calldata marketTransfer, bytes calldata signature) virtual external {
        IAccount account = IAccount(getAccountAddress(marketTransfer.action.common.account));
        _marketTransferWithSignature(account, marketTransfer, signature);
    }

    function _marketTransferWithSignature(IAccount account, MarketTransfer calldata marketTransfer, bytes calldata signature) internal {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyMarketTransfer(marketTransfer, signature);
        _ensureValidSigner(marketTransfer.action.common.account, marketTransfer.action.common.signer);

        // only Markets with DSU collateral are supported
        IMarket market = IMarket(marketTransfer.market);
        if (!market.token().eq(DSU)) revert ControllerUnsupportedMarket(address(market));

        account.marketTransfer(market, marketTransfer.amount);
    }

    /// @inheritdoc IController
    function changeRebalanceConfigWithSignature(
        RebalanceConfigChange calldata configChange,
        bytes calldata signature
    ) virtual external {
        _changeRebalanceConfigWithSignature(configChange, signature);
    }

    function _changeRebalanceConfigWithSignature(RebalanceConfigChange calldata configChange, bytes calldata signature) internal {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyRebalanceConfigChange(configChange, signature);
        _ensureValidSigner(configChange.action.common.account, configChange.action.common.signer);

        // sum of the target allocations of all markets in the group
        _updateRebalanceGroup(configChange, configChange.action.common.account);
    }

    /// @inheritdoc IController
    function rebalanceConfig(
        address owner,
        uint256 group,
        address market
    ) external view returns (RebalanceConfig memory config_) {
        config_ = config[owner][group][market];
    }

    /// @inheritdoc IController
    function rebalanceGroupMarkets(
        address owner,
        uint256 group
    ) external view returns (address[] memory markets) {
        markets = groupToMarkets[owner][group];
    }

    /// @inheritdoc IController
    function updateSigner(address signer, bool newEnabled) public {
        signers[msg.sender][signer] = newEnabled;
        emit SignerUpdated(msg.sender, signer, newEnabled);
    }

    /// @inheritdoc IController
    function updateSignerWithSignature(
        SignerUpdate calldata signerUpdate,
        bytes calldata signature
    ) virtual external {
        _updateSignerWithSignature(signerUpdate, signature);
    }

    function _updateSignerWithSignature(SignerUpdate calldata signerUpdate,  bytes calldata signature) internal {
        // ensure the message was signed only by the owner, not an existing delegate
        verifier.verifySignerUpdate(signerUpdate, signature);
        address owner = signerUpdate.action.common.account;
        if (signerUpdate.action.common.signer != owner) revert ControllerInvalidSigner();

        signers[owner][signerUpdate.signer] = signerUpdate.approved;
        emit SignerUpdated(owner, signerUpdate.signer, signerUpdate.approved);
    }

    /// @inheritdoc IController
    function withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) virtual external {
        IAccount account = IAccount(getAccountAddress(withdrawal.action.common.account));
        _withdrawWithSignature(account, withdrawal, signature);
    }

    function _withdrawWithSignature(IAccount account, Withdrawal calldata withdrawal, bytes calldata signature) internal {
        // ensure the message was signed by the owner or a delegated signer
        verifier.verifyWithdrawal(withdrawal, signature);
        _ensureValidSigner(withdrawal.action.common.account, withdrawal.action.common.signer);

        // call the account's implementation to push to owner
        account.withdraw(withdrawal.amount, withdrawal.unwrap);
    }

    /// @dev calculates the account address and reverts if user is not authorized to sign transactions for the owner
    function _ensureValidSigner(address owner, address signer) private view {
        if (signer != owner && !signers[owner][signer]) revert ControllerInvalidSigner();
    }

    /// @dev overwrites rebalance configuration of all markets for a particular owner and group
    /// @param message already-verified message with new configuration
    /// @param owner identifies the owner of the collateral account
    function _updateRebalanceGroup(
        RebalanceConfigChange calldata message,
        address owner
    ) private {
        // ensure group index is valid
        if (message.group == 0 || message.group > MAX_GROUPS_PER_OWNER)
            revert ControllerInvalidRebalanceGroup();

        if (message.markets.length > MAX_MARKETS_PER_GROUP)
            revert ControllerInvalidRebalanceMarkets();

        // delete the existing group
        for (uint256 i; i < groupToMarkets[owner][message.group].length; i++) {
            address market = groupToMarkets[owner][message.group][i];
            delete config[owner][message.group][market];
            delete marketToGroup[owner][market];
        }
        delete groupToMarkets[owner][message.group];

        UFixed6 totalAllocation;
        for (uint256 i; i < message.markets.length; i++) {
            // ensure market is not pointing to a different group
            uint256 currentGroup = marketToGroup[owner][message.markets[i]];
            if (currentGroup != 0)
                revert ControllerMarketAlreadyInGroup(message.markets[i], currentGroup);

            // rewrite over all the old configuration
            marketToGroup[owner][message.markets[i]] = message.group;
            config[owner][message.group][message.markets[i]] = message.configs[i];
            groupToMarkets[owner][message.group].push(message.markets[i]);

            // ensure target allocation across all markets totals 100%
            // read from storage to trap duplicate markets in the message
            totalAllocation = totalAllocation.add(message.configs[i].target);

            emit RebalanceMarketConfigured(
                owner,
                message.group,
                message.markets[i],
                message.configs[i]
            );
        }

        // if not deleting the group, ensure rebalance targets add to 100%
        if (message.markets.length != 0 && !totalAllocation.eq(UFixed6Lib.ONE))
            revert ControllerInvalidRebalanceTargets();

        emit RebalanceGroupConfigured(owner, message.group, message.markets.length);
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import { IEmptySetReserve } from "@equilibria/emptyset-batcher/interfaces/IEmptySetReserve.sol";
import { Token6 } from "@equilibria/root/token/types/Token6.sol";
import { Token18 } from "@equilibria/root/token/types/Token18.sol";

import { IAccount } from "../interfaces/IAccount.sol";
import { IVerifier } from "../interfaces/IVerifier.sol";
import { DeployAccount } from "../types/DeployAccount.sol";
import { MarketTransfer } from "../types/MarketTransfer.sol";
import { RebalanceConfig, RebalanceConfigChange } from "../types/RebalanceConfig.sol";
import { SignerUpdate } from "../types/SignerUpdate.sol";
import { Withdrawal } from "../types/Withdrawal.sol";

/// @notice Facilitates unpermissioned actions between collateral accounts and markets
interface IController {
    /// @notice Emitted when a collateral account is deployed
    /// @param owner EOA for whom the collateral account was created
    /// @param account contract address of the collateral account
    event AccountDeployed(address indexed owner, IAccount indexed account);

    /// @notice Emitted when a rebalance group is created or updated
    /// @param owner Owner of the collateral account for which the rebalance group was created or modified
    /// @param group Uniquely identifies the rebalance group
    /// @param markets Number of markets in the group (0 if group was deleted)
    event RebalanceGroupConfigured(address indexed owner, uint256 indexed group, uint256 markets);

    /// @notice Emitted for each market in a rebalance group upon creation of the group
    /// or when any changes are made to the group
    /// @param owner Owner of the collateral account for which the rebalance group was created or modified
    /// @param group Uniquely identifies the rebalance group
    /// @param market The Perennial market for which this configuration applies
    /// @param newConfig Rebalance configuration for the market, which may or may not have changed
    event RebalanceMarketConfigured(
        address indexed owner,
        uint256 indexed group,
        address indexed market,
        RebalanceConfig newConfig
    );

    /// @notice Emitted when a delegated signer for a collateral account is assigned, enabled, or disabled
    /// @param owner User who is granting rights to interact with their collateral account
    /// @param signer Identifies the signer whose status to update
    /// @param newEnabled True to assign or enable, false to disable
    event SignerUpdated(address indexed owner, address indexed signer, bool newEnabled);

    // sig: 0x2c51df8b
    /// @custom:error Insufficient funds in the collateral account to compensate relayer/keeper
    error ControllerCannotPayKeeper();

    // sig: 0x1444bc5d
    /// @custom:error A RebalanceConfigChange message had a mismatch in number of markets and configs
    error ControllerInvalidRebalanceConfig();

    // sig: 0xc640159e
    /// @custom:error Group number was out-of-range; each collateral account may have up to 8 groups, indexed 1-8
    error ControllerInvalidRebalanceGroup();

    // sig: 0xf065594a
    /// @custom:error Group has too many markets; each group may have 1-4 markets
    error ControllerInvalidRebalanceMarkets();

    // sig: 0xcbe71ce7
    /// @custom:error The sum of `target` collateral allocations for each market in a group does not total 100%.
    /// This could also indicate a duplicate market was in the list.
    error ControllerInvalidRebalanceTargets();

    // sig: 0x2ee770d20
    /// @custom:error Signer is not authorized to interact with the specified collateral account
    error ControllerInvalidSigner();

    // sig: 0xcdfdf387
    /// @custom:error A market in this rebalancing configuration is already a member of a different group
    /// @param market Identifies which market in the message which is causing the problem
    /// @param group Identifies the group in which the aforementioned market is a member
    error ControllerMarketAlreadyInGroup(address market, uint256 group);

    // sig: 0x3cb60bed
    /// @custom:error Attempt to interact with a Market which does not use DSU as collateral
    /// @param market Market with non-DSU collateral
    error ControllerUnsupportedMarket(address market);

    /// @notice Sets contract addresses used for message verification and token management
    /// @param verifier Contract used to validate messages were signed by the sender
    /// @param usdc USDC token address
    /// @param dsu DSU token address
    /// @param reserve DSU Reserve address, used by Account
    function initialize(
        IVerifier verifier,
        Token6 usdc,
        Token18 dsu,
        IEmptySetReserve reserve
    ) external;

    /// @notice Returns the deterministic address of the collateral account for a user,
    /// regardless of whether or not it exists.
    /// @param owner Identifies the user whose collateral account address is desired
    function getAccountAddress(address owner) external view returns (address);

    /// @notice Deploys the collateral account for msg.sender and returns the address of the account
    function deployAccount() external returns (IAccount);

    /// @notice Deploys a collateral account via a signed message
    /// @param deployAccount Message requesting creation of a collateral account
    /// @param signature ERC712 message signature
    function deployAccountWithSignature(DeployAccount calldata deployAccount, bytes calldata signature) external;

    /// @notice Transfers tokens between a collateral account and a specified Perennial Market
    /// @param marketTransfer Message requesting a deposit to or withdrawal from the Market
    /// @param signature ERC712 message signature
    function marketTransferWithSignature(MarketTransfer calldata marketTransfer, bytes calldata signature) external;

    /// @notice Adjusts the rebalancing configuration of one or more markets
    /// @param configChange Message with new rebalance group configuration
    /// @param signature ERC712 message signature
    function changeRebalanceConfigWithSignature(RebalanceConfigChange calldata configChange,
        bytes calldata signature) external;

    /// @notice Retrieves rebalance configuration for a specified owner, group, and market
    /// @param owner User for whom the collateral account was created
    /// @param group Identifies a collection of markets, each with their own configuration
    /// @param market Identifies which Perennial market for which the configuration is desired
    function rebalanceConfig(
        address owner,
        uint256 group,
        address market
    ) external view returns (RebalanceConfig memory config);

    /// @notice Retrieves array of markets in an owner's rebalance group
    /// @param owner User for whom the collateral account was created
    /// @param group Identifies which collection of markets is desired for the owner
    /// @return markets Array containing the of address of each market in the rebalance group
    function rebalanceGroupMarkets(
        address owner,
        uint256 group
    ) external view returns (address[] memory markets);

    /// @notice Updates the status of a delegated signer for the caller's collateral account
    /// @param signer The signer to update
    /// @param newEnabled The new status of the opersignerator
    function updateSigner(address signer, bool newEnabled) external;

    /// @notice Updates the status of a delegated signer for the specified collateral account
    /// @param updateSigner Message requesting a delegation update
    /// @param signature ERC712 message signature
    function updateSignerWithSignature(SignerUpdate calldata updateSigner, bytes calldata signature) external;

    /// @notice Transfers tokens from the collateral account back to the owner of the account
    /// @param withdrawal Message requesting a withdrawal
    /// @param signature ERC712 message signature
    function withdrawWithSignature(Withdrawal calldata withdrawal, bytes calldata signature) external;
}
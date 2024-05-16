// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { VerifierBase } from "@equilibria/root/verifier/VerifierBase.sol";

import { IVerifier } from "./interfaces/IVerifier.sol";
import { Action, ActionLib } from "./types/Action.sol";
import { DeployAccount, DeployAccountLib } from "./types/DeployAccount.sol";
import { SignerUpdate, SignerUpdateLib } from "./types/SignerUpdate.sol";
import { MarketTransfer, MarketTransferLib } from "./types/MarketTransfer.sol";
import { Withdrawal, WithdrawalLib } from "./types/Withdrawal.sol";

/// @title Verifier
/// @notice ERC712 signed message verifier for the Perennial V2 Collateral Accounts package.
contract Verifier is VerifierBase, IVerifier {
    /// @dev Initializes the domain separator and parameter caches
    constructor() EIP712("Perennial V2 Collateral Accounts", "1.0.0") { }

    /// @inheritdoc IVerifier
    function verifyAction(Action calldata action, bytes calldata signature)
        external
        validateAndCancel(action.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(ActionLib.hash(action)), signature);
    }

    /// @inheritdoc IVerifier
    function verifyDeployAccount(DeployAccount calldata deployAccount, bytes calldata signature)
        external
        validateAndCancel(deployAccount.action.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(DeployAccountLib.hash(deployAccount)), signature);
    }

    /// @inheritdoc IVerifier
    function verifyMarketTransfer(MarketTransfer calldata marketTransfer, bytes calldata signature) 
        external 
        validateAndCancel(marketTransfer.action.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(MarketTransferLib.hash(marketTransfer)), signature);
    }

    /// @inheritdoc IVerifier
    function verifySignerUpdate(SignerUpdate calldata signerUpdate, bytes calldata signature)
        external
        validateAndCancel(signerUpdate.action.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(SignerUpdateLib.hash(signerUpdate)), signature);
    }

    /// @inheritdoc IVerifier
    function verifyWithdrawal(Withdrawal calldata withdrawal, bytes calldata signature)
        external
        validateAndCancel(withdrawal.action.common, signature) returns (address)
    {
        return ECDSA.recover(_hashTypedDataV4(WithdrawalLib.hash(withdrawal)), signature);
    }
}

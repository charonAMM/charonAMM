// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./interfaces/IAccount.sol";
import "./interfaces/IEntryPoint.sol";
import "./Charon.sol";

contract CharonMaster is IAccount,Charon {
    using UserOperationLib for UserOperation;

    /**
     * Return value in case of signature failure, with no time-range.
     * Equivalent to _packValidationData(true,0,0).
     */
    uint256 internal constant SIG_VALIDATION_FAILED = 1;
    IEntryPoint public immutable entryPoint;

    /**
     * @dev constructor to launch charon
     * @param _verifier2 address of the verifier contract (circom generated sol)
     * @param _verifier16 address of the verifier contract (circom generated sol)
     * @param _hasher address of the hasher contract (mimC precompile)
     * @param _token address of token on this chain of the system
     * @param _fee fee when withdrawing liquidity or trading (pct of tokens)
     * @param _oracles address array of oracle contracts
     * @param _merkleTreeHeight merkleTreeHeight (should match that of circom compile)
     * @param _chainID chainID of this chain
     * @param _name name of pool token
     * @param _symbol of pool token
     * @param _anEntryPoint entryPoint address
     */
    constructor(address _verifier2,
                address _verifier16,
                address _hasher,
                address _token,
                uint256 _fee,
                address[] memory _oracles,
                uint32 _merkleTreeHeight,
                uint256 _chainID,
                string memory _name,
                string memory _symbol,
                IEntryPoint _anEntryPoint
                ) 
                Charon(_verifier2, 
                _verifier16, 
                _hasher, 
                _token, 
                _fee, 
                _oracles, 
                _merkleTreeHeight,
                _chainID, 
                _name, 
                _symbol){
        entryPoint = _anEntryPoint;
    }

    /**
     * Return the account nonce.
     * This method returns the next sequential nonce.
     * For a nonce of a specific key, use `entrypoint.getNonce(account, key)`
     */
    function getNonce() public view returns (uint256) {
        return entryPoint.getNonce(address(this), 0);
    }
    /**
     * Validate user's signature and nonce.
     * Subclass doesn't need to override this method. Instead,
     * it should override the specific internal validation methods.
     * @param _userOp              - The user operation to validate.
     * @param _userOpHash          - The hash of the user operation.
     * @param _missingAccountFunds - The amount of funds missing from the account
     *                              to pay for the user operation.
     */
    function validateUserOp(
        UserOperation calldata _userOp,
        bytes32 _userOpHash,
        uint256 _missingAccountFunds
    ) external override returns (uint256 _validationData) {
        _requireFromEntryPoint();
        _validationData = _validateSignature(_userOp, _userOpHash);
        _payPrefund(_missingAccountFunds);
    }

    /**
     * Sends to the entrypoint (msg.sender) the missing funds for this transaction.
     * SubClass MAY override this method for better funds management
     * (e.g. send to the entryPoint more than the minimum required, so that in future transactions
     * it will not be required to send again).
     * @param missingAccountFunds - The minimum value this method should send the entrypoint.
     *                              This value MAY be zero, in case there is enough deposit,
     *                              or the userOp has a paymaster.
     */
    function _payPrefund(uint256 missingAccountFunds) internal {
        if (missingAccountFunds != 0) {
            (bool success, ) = payable(msg.sender).call{
                value: missingAccountFunds,
                gas: type(uint256).max
            }("");
            (success);
        }
    }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     */
    function execute(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPoint();
        require(dest == address(this), "can only call this contract");
        _call(dest, value, func);
    }

    /**
     * execute a sequence of transactions
     * @dev to reduce gas consumption for trivial case (no value), use a zero-length array to mean zero value
     */
    function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external {
        _requireFromEntryPoint();
        require(dest.length == func.length && (value.length == 0 || value.length == func.length), "wrong array lengths");
        if (value.length == 0) {
            for (uint256 i = 0; i < dest.length; i++) {
                 require(dest[i] == address(this), "can only call this contract");
                _call(dest[i], 0, func[i]);
            }
        } else {
            for (uint256 i = 0; i < dest.length; i++) {
                require(dest[i] == address(this), "can only call this contract");
                _call(dest[i], value[i], func[i]);
            }
        }
    }


    // Require the function call went through EntryPoint or owner
    function _requireFromEntryPoint() internal view {
        require(msg.sender == address(entryPoint), "account: not EntryPoint");
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
    internal returns (uint256 validationData) {
        return 0;
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value : value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
}

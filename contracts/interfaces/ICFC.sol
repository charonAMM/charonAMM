// SPDX-License-Identifier: None
pragma solidity ^0.8.0;

/**
 * @dev Interface of the charon fee contract
 */
interface ICFC {
    function addFees(uint256 _amount, bool _isCHD) external;
}

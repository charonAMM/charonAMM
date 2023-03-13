// SPDX-License-Identifier: None
pragma solidity ^0.8.0;

/**
 * @dev Interface of the gnosisAMBBridge
 */
interface IAMB {
    function requireToGetInformation(bytes32 _requestSelector, bytes calldata _data) external returns (bytes32);
}

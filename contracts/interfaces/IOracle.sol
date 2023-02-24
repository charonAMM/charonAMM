// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 @title IOracle
 @dev Interface of the Oracle contract for the CharonAMM
 **/
interface IOracle {
    function getCommitment(bytes memory _inputData, address _caller) external returns(bytes memory);
    function sendCommitment(bytes memory _data) external;
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 @title IOracle
 @dev Interface of the Oracle contract for the CharonAMM
 **/
interface IOracle {
    function getCommitment(bytes memory _inputData) external returns(bytes memory _value, address _caller);
    function sendCommitment(bytes memory _data) external;
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 @title IOracle
 @dev Interface of the Oracle contract for the CharonAMM
 **/
interface IOracle {
    function getCommitment(uint256 _chain, uint256 _depositId) external returns(bytes memory);
}
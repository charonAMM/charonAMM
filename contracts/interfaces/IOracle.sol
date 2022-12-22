// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 @title IOracle
 @dev Interface of the Oracle contract for the CharonAMM
 **/
interface IOracle {
    function getCommitment(uint256 _chain, address _partnerContract, uint256 _depositId) external view returns(bytes memory, address);
}
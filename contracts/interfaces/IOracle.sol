//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IOracle {
    function getCommitment(uint256 _chain, uint256 _id) external view returns(bytes32);
}
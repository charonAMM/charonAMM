// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IOracle {
    function getCommitment(uint256 _chain, uint256 _depositId) external returns(bytes memory);
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 @title IHasher
 @dev Interface for the precompiled poseidon hasher
 **/
interface IHasher {
  function poseidon(bytes32[2] calldata _inputs) external pure returns (bytes32);
}
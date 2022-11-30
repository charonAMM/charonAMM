// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IHasher {
  function poseidon(bytes32[2] calldata _inputs) external pure returns (bytes32);
}
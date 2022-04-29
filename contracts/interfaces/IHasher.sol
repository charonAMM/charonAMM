// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

//0x83584f83f26af4edda9cbe8c730bc87c364b28fe - mainnet tornado cash usage (a circom zkp thing)
interface IHasher {
  function MiMCSponge(uint256 in_xL, uint256 in_xR) external pure returns (uint256 xL, uint256 xR);
}
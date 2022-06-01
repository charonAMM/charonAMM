// SPDX-License-Identifier: GPL-3.0
// heavily inspired by https://github.com/tornadocash/tornado-core/blob/master/contracts/MerkleTreeWithHistory.sol
pragma solidity ^0.8.0;

interface IPoseidon {
  function poseidon(uint256[2] memory inputs) external pure returns (uint256);
}

// SPDX-License-Identifier: GPL-3.0
// heavily inspired by https://github.com/tornadocash/tornado-core/blob/master/contracts/MerkleTreeWithHistory.sol
pragma solidity ^0.8.0;


interface Hasher {
    function poseidon(bytes32[2] calldata leftRight) external pure returns (bytes32);
}
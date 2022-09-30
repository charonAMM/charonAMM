// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "../MerkleTreeWithHistory.sol";

contract TestMerkleTree is MerkleTreeWithHistory{

    constructor(uint32 _levels, address _hasher) MerkleTreeWithHistory(_levels,_hasher){}

    function insert(bytes32 _leaf1, bytes32 _leaf2) internal returns (uint32 _nextIndex){
        return _insert(_leaf1,_leaf2);
    }
}

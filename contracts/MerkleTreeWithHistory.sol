// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.4;

import "./interfaces/IHasher.sol";

/**
 @title MerkleTreeWithHistory
 @dev solidity implementation of a merkle tree with historical inputs
 * taken from the poseidon-tornado repository
**/  
contract MerkleTreeWithHistory {
    Hasher public hasher;
    uint32 public currentRootIndex = 0;//make private for deployment
    uint32 public immutable levels;
    uint32 public nextIndex = 0;//make private for deployment
    uint32 private constant ROOT_HISTORY_SIZE = 100;
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant ZERO_VALUE =
        21663839004416932945382355908790599225266501822907911457504978515578255421292; // = keccak256("tornado") % FIELD_SIZE
    bytes32[] private filledSubtrees;
    bytes32[] private zeros;
    bytes32[ROOT_HISTORY_SIZE] public roots;//make private for deployment

    constructor(uint32 _treeLevels, address _hasher) {
        require(_treeLevels > 0, "_treeLevels should be greater than zero");
        require(_treeLevels < 32, "_treeLevels should be less than 32");
        hasher = Hasher(_hasher);
        levels = _treeLevels;
        bytes32 currentZero = bytes32(ZERO_VALUE);
        zeros.push(currentZero);
        filledSubtrees.push(currentZero);
        for (uint32 i = 1; i < _treeLevels; i++) {
            currentZero = hashLeftRight(currentZero, currentZero);
            zeros.push(currentZero);
            filledSubtrees.push(currentZero);
        }
        roots[0] = hashLeftRight(currentZero, currentZero);
    }

    /**
    @dev Hash 2 tree leaves, returns MiMC(_left, _right)
  */
    function hashLeftRight(bytes32 _left, bytes32 _right) public view returns (bytes32){
        require(uint256(_left) < FIELD_SIZE, "_left should be inside the field");
        require(uint256(_right) < FIELD_SIZE,"_right should be inside the field");
        bytes32[2] memory leftright = [_left, _right];
        return hasher.poseidon(leftright);
    }

    function _insert(bytes32 _leaf) internal returns (uint32 index) {
        uint32 currentIndex = nextIndex;
        require(
            currentIndex != uint32(2)**levels,
            "Merkle tree is full. No more leafs can be added"
        );
        nextIndex += 1;
        bytes32 currentLevelHash = _leaf;
        bytes32 left;
        bytes32 right;
        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(left, right);
            currentIndex /= 2;
        }
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = currentLevelHash;
        return nextIndex - 1;
    }

    /**
    @dev Whether the root is present in the root history
  */
    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == 0) return false;
        uint32 _i = currentRootIndex;
        do {
            if (_root == roots[_i]) return true;
            if (_i == 0) _i = ROOT_HISTORY_SIZE;
            _i--;
        } while (_i != currentRootIndex);
        return false;
    }

    /**
    @dev Returns the last root
  */
    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }
}

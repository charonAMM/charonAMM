// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./interfaces/IHasher.sol";

/**
 @title MerkleTreeWithHistory
 @dev a merkle tree contract that tracks historical roots
**/  
contract MerkleTreeWithHistory {
  uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292; // = keccak256("tornado") % FIELD_SIZE

  IHasher public immutable hasher;
  uint32 public immutable levels;

  // make public for debugging, make all private for deployment
  // filledSubtrees and roots could be bytes32[size], but using mappings makes it cheaper because
  // it removes index range check on every interaction
  mapping(uint256 => bytes32) public filledSubtrees;
  mapping(uint256 => bytes32) roots;
  mapping(uint256 => bytes32) zeros;
  uint32 public constant ROOT_HISTORY_SIZE = 100;
  uint32 private currentRootIndex = 0; 
  uint32 nextIndex = 0;

  constructor(uint32 _levels, address _hasher) {
    require(_levels > 0, "_levels should be greater than zero");
    require(_levels < 32, "_levels should be less than 32");
    levels = _levels;
    hasher = IHasher(_hasher);
    zeros[0] = bytes32(ZERO_VALUE);
    uint32 _i;
    for(_i =1; _i<= 32; _i++){
      zeros[_i] = IHasher(_hasher).poseidon([zeros[_i-1], zeros[_i-1]]);
    }
    for (_i=0; _i< _levels; _i++) {
      filledSubtrees[_i] = zeros[_i];
    }
    roots[0] = zeros[_levels];
  }

  /**
    @dev Hash 2 tree leaves, returns Poseidon(_left, _right)
  */
  function hashLeftRight(bytes32 _left, bytes32 _right) public view returns (bytes32) {
    require(uint256(_left) < FIELD_SIZE, "_left should be inside the field");
    require(uint256(_right) < FIELD_SIZE, "_right should be inside the field");
    bytes32[2] memory _input;
    _input[0] = _left;
    _input[1] = _right;
    return hasher.poseidon(_input);
  }

  //getters
  /**
    @dev Returns the last root
  */
  function getLastRoot() external view returns (bytes32) {
    return roots[currentRootIndex];
  }

  /**
    @dev Whether the root is present in the root history
  */
  function isKnownRoot(bytes32 _root) public view returns (bool) {
    if (_root == 0) {
      return false;
    }
    uint32 _currentRootIndex = currentRootIndex;
    uint32 _i = _currentRootIndex;
    do {
      if (_root == roots[_i]) {
        return true;
      }
      if (_i == 0) {
        _i = ROOT_HISTORY_SIZE;
      }
      _i--;
    } while (_i != _currentRootIndex);
    return false;
  }

  /// @dev provides Zero (Empty) elements for a MiMC MerkleTree. Up to 32 levels
  function getZeros(uint256 _i) public view returns (bytes32) {
    if(_i <= 32){
      return zeros[_i];
    }
    else revert("Index out of bounds");
  }

  //Internal funcs
  // Modified to insert pairs of leaves for better efficiency
  function _insert(bytes32 _leaf1, bytes32 _leaf2) internal returns (uint32 index) {
    uint32 _nextIndex = nextIndex;
    require(_nextIndex != uint32(2)**levels, "Merkle tree is full. No more leaves can be added");
    uint32 currentIndex = _nextIndex / 2;
    bytes32 currentLevelHash = hashLeftRight(_leaf1, _leaf2);
    bytes32 left;
    bytes32 right;
    for (uint32 i = 1; i < levels; i++) {
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
    uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
    currentRootIndex = newRootIndex;
    roots[newRootIndex] = currentLevelHash;
    nextIndex = _nextIndex + 2;
    return _nextIndex;
  }
}

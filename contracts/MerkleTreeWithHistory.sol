// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./interfaces/IHasher.sol";

/**
 @title MerkleTreeWithHistory
 @dev a merkle tree contract that tracks historical roots
**/  
contract MerkleTreeWithHistory {
  /*Storage*/
  uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292; // = keccak256("tornado") % FIELD_SIZE

  IHasher public immutable hasher;//implementation of hasher
  uint32 public immutable levels;//levels in the merkle tree

  // make public for debugging, make all private for deployment
  // filledSubtrees and roots could be bytes32[size], but using mappings makes it cheaper because
  // it removes index range check on every interaction
  mapping(uint256 => bytes32) filledSubtrees;
  mapping(uint256 => bytes32) roots;
  mapping(uint256 => bytes32) zeros;
  uint32 public constant ROOT_HISTORY_SIZE = 100;
  uint32 private currentRootIndex = 0; 
  uint32 nextIndex = 0;

  /*functions*/
  /**
    * @dev constructor for initializing tree
    * @param _levels uint32 merkle tree levels
    * @param _hasher address of poseidon hasher
    */
  constructor(uint32 _levels, address _hasher) {
    require(_levels > 0);
    require(_levels < 32);
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
    * @dev hash 2 tree leaves, returns Poseidon(_left, _right)
    * @param _left bytes32 to hash
    * @param _right bytes32 to hash
    * @return bytes32 hash of input
    */
  function hashLeftRight(bytes32 _left, bytes32 _right) public view returns (bytes32) {
    require(uint256(_left) < FIELD_SIZE);
    require(uint256(_right) < FIELD_SIZE);
    bytes32[2] memory _input;
    _input[0] = _left;
    _input[1] = _right;
    return hasher.poseidon(_input);
  }

  //getters
  /**
    * @dev gets last root of the merkle tree
    * @return bytes32 root
    */
  function getLastRoot() external view returns (bytes32) {
    return roots[currentRootIndex];
  }

  /**
    * @dev checks if inputted root is known historical root of tree
    * @param _root bytes32 supposed historical root
    * @return bool if root was ever made from merkleTree
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

  /**
    * @dev provides zero (empty) elements for a poseidon MerkleTree. Up to 32 levels
    * @param _i uint256 0-32 number of location of zero
    * @return bytes32 zero element of tree at input location
    */
  function getZeros(uint256 _i) external view returns (bytes32) {
    if(_i <= 32){
      return zeros[_i];
    }
    else revert();
  }

  /*internal functions*/
  /**
    * @dev allows users to insert pairs of leaves into tree
    * @param _leaf1 bytes32 first leaf to add
    * @param _leaf2 bytes32 second leaf to add
    * @return _nextIndex uint32 index of insertion
    */
  function _insert(bytes32 _leaf1, bytes32 _leaf2) internal returns (uint32 _nextIndex) {
    _nextIndex = nextIndex;
    require(_nextIndex != uint32(2)**levels);
    uint32 _currentIndex = _nextIndex / 2;
    bytes32 _currentLevelHash = hashLeftRight(_leaf1, _leaf2);
    bytes32 _left;
    bytes32 _right;
    for (uint32 _i = 1; _i < levels; _i++) {
      if (_currentIndex % 2 == 0) {
        _left = _currentLevelHash;
        _right = zeros[_i];
        filledSubtrees[_i] = _currentLevelHash;
      } else {
        _left = filledSubtrees[_i];
        _right = _currentLevelHash;
      }
      _currentLevelHash = hashLeftRight(_left, _right);
      _currentIndex /= 2;
    }
    uint32 _newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
    currentRootIndex = _newRootIndex;
    roots[_newRootIndex] = _currentLevelHash;
    nextIndex = _nextIndex + 2;
  }
}

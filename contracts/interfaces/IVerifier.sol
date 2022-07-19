// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 @title IVerifier
 @dev solidity interface for the verifier contract created by the snarkjs library
**/  
interface IVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[6] calldata input
    ) external view returns (bool);
}
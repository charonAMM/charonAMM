// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 @title IVerifier
 @dev solidity interface for the verifier contract created by the snarkjs library
**/  
interface IVerifier {
    function verifyProof(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[8] memory input
    ) external view returns (bool);
}
//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

/**
 @title IVerifier
 @dev Interface for the verifier contracts created by the circom files
 **/
interface IVerifier {
 function verifyProof(uint[2] memory _a,uint[2][2] memory _b,uint[2] memory _c,uint[8] memory _input) external view returns(bool);
 function verifyProof(uint[2] memory _a,uint[2][2] memory _b,uint[2] memory _c,uint[22] memory _input) external view returns(bool);
}
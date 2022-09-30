//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IVerifier {
 function verifyProof(uint[2] memory a,uint[2][2] memory b,uint[2] memory c,uint[8] memory input) external view returns(bool);
 function verifyProof(uint[2] memory a,uint[2][2] memory b,uint[2] memory c,uint[22] memory input) external view returns(bool);
}
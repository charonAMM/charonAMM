pragma solidity ^0.8.0;

interface IOracle {
    function getPriceData(bytes32 _id) external view returns(uint256);
    function getCommitment(uint256 _chain, uint256 _id) external view returns(bytes32);
}
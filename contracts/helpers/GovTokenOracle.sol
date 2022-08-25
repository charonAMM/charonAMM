//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "usingtellor/contracts/UsingTellor.sol";

/**
 @title Oracle
 @dev oracle contract for use in the charon system implementing tellor
 **/
contract GovTokenOracle is UsingTellor{

    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address payable _tellor) UsingTellor(_tellor){}

    /**
     * @dev grabs the merkle tree of balances of the charon governance token
     */
    function getGovTokenBalances() public view returns(bytes32[] memory){
        require(_chain.length == _depositId.length, "must be same length arrays");
        bytes memory _value;
        bool _didGet;
        bytes32 _queryId;
        bytes32[] memory _commitments  = new bytes32[](_chain.length);
        for(uint8 _i; _i< _chain.length;_i++){
            _queryId= keccak256(abi.encode("Charon",abi.encode(_chain[_i],_depositId[_i])));
            (_didGet,_value,) = getDataBefore(_queryId,block.timestamp - 12 hours);
            require(_didGet);
            _commitments[_i] = abi.decode(_value,(bytes32));
        }
        return _commitments;
    }
}
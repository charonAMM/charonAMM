//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "usingtellor/contracts/UsingTellor.sol";

contract Oracle is UsingTellor{

    constructor(address payable _tellor) UsingTellor(_tellor){}

    function getCommitment(uint256 _chain, uint256 _depositId) external view returns(bytes32 _commitment){
        bytes memory _value;
        bool _didGet;
        bytes32 _queryId = keccak256(abi.encode("Charon",abi.encode(_chain,_depositId)));
        (_didGet,_value,) = getDataBefore(_queryId,block.timestamp - 1 hours);//what should this timeframe be? (should be an easy verify)
        require(_didGet);
        _commitment = abi.decode(_value,(bytes32));
    }
}
//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "usingtellor/contracts/UsingTellor.sol";
import "./extensions/FxBaseRootTunnel.sol";

/**
 @title Oracle
 @dev oracle contract for use in the charon system implementing tellor
 **/
contract ETHtoPOLBridge is UsingTellor, FxBaseRootTunnel{

    address public reciever; //addrss on polygon to get message
    uint256 public id;
    mapping(uint256 => bytes) idToData;

    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address payable _tellor, address _checkpointManager, address _fxRoot, address _fxChildTunnel, address _reciever) 
        UsingTellor(_tellor)
        FxBaseRootTunnel(_checkpointManager, _fxRoot){
            fxChildTunnel = _fxChildTunnel;
            reciever = _reciever; 
        }

    function _processMessageFromChild(bytes memory _data) internal override {
        id++;
        idToData[id] = _data;
    }

    function getCommitment(bytes memory _inputData) external view returns(bytes memory _value){
        return idToData[_bytesToUint(_inputData)];
    }

    /**
     * @dev grabs the oracle value from the tellor oracle
     * @param _timestamp timestamp to grab
     * @param _chainID chain to grab
     * @param _address address of the CIT token on mainnet Ethereum
     */
    function getRootHashAndSupply(uint256 _timestamp,uint256 _chainID, address _address) public view returns(bytes memory _value){
        bytes32 _queryId = keccak256(abi.encode("CrossChainBalance",abi.encode(_chainID,_address,_timestamp)));
        (_value,_timestamp) = getDataBefore(_queryId,block.timestamp - 12 hours);
        require(_timestamp > 0, "timestamp must be present");
    }

    function sendCommitment(bytes memory _data) external{
        _sendMessageToChild(_data);
    }

    function _bytesToUint(bytes memory _b) internal pure returns (uint256 _n){
        for(uint256 _i=0;_i<_b.length;_i++){
            _n = _n + uint(uint8(_b[_i]))*(2**(8*(_b.length-(_i+1))));
        }
    }

}
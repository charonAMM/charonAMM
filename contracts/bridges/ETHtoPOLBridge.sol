//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "usingtellor/contracts/UsingTellor.sol";
import "./extensions/FxBaseRootTunnel.sol";

/**
 @title Oracle
 @dev oracle contract for use in the charon system implementing tellor
 **/
contract ETHtoPOLBridge is UsingTellor, FxBaseRootTunnel{

    address public charon;

    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address payable _tellor, address _checkpointManager, address _fxRoot) 
        UsingTellor(_tellor)
        FxBaseRootTunnel(_checkpointManager, _fxRoot){}

    function setCharon(address _charon) external{
        require(charon == address(0));
        charon = _charon;
    }

    function getCommitment(bytes memory _inputData) external virtual returns(bytes memory _value, address _caller){
        bytes memory _message = _validateAndExtractMessage(_inputData);
        return (_message,address(0));
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
        require(msg.sender == charon, "must be charon");
        _sendMessageToChild(_data);
    }
}
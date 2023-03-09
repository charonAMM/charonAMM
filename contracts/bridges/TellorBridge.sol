//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "usingtellor/contracts/UsingTellor.sol";
import "hardhat/console.sol";
/**
 @title Oracle
 @dev oracle contract for use in the charon system implementing tellor
 **/
contract TellorBridge is UsingTellor{

    address public charon;//address of charon on other chain
    uint256 public connectedChainId;
    bytes4 private constant func_selector = bytes4(keccak256("getOracleSubmission(uint256)"));
    
    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address payable _tellor) UsingTellor(_tellor){
    }

    /**
     * @dev constructor to launch contract 
     * @param _charon charon contract address on other chain
     * @param _connectedChainId other chainId
     */
    function setPartnerInfo(address _charon, uint256 _connectedChainId) external{
        require(charon == address(0));
        charon = _charon;
        connectedChainId = _connectedChainId;
    }

    function getCommitment(bytes memory _inputData) external view returns(bytes memory _value, address _caller){
        require(charon != address(0), "charon address should be set");
        uint256 _timestamp;
        uint256 _depositId = abi.decode(_inputData,(uint256));
        bytes memory _callData = abi.encodeWithSelector(func_selector,_depositId);
        bytes32 _queryId = keccak256(abi.encode("EVMCall",abi.encode(connectedChainId, charon, _callData)));
        (_value,_timestamp) = getDataBefore(_queryId,block.timestamp - 12 hours);
        _caller = tellor.getReporterByTimestamp(_queryId,_timestamp);
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
        //don't need to do anything, all on the read side
    }
}
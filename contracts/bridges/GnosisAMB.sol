//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "usingtellor/contracts/UsingTellor.sol";
import "../interfaces/IAMB.sol";
/**
 @title Oracle
 @dev oracle contract for use in the charon system implementing tellor
 **/
contract GnosisAMB is UsingTellor{

    IAMB public ambBridge;
    address public charon; //address of charon on this chain
    address public connectedCharon;//address of charon on other chain
    bytes32[] public messageIds;
    mapping(bytes32 => address) public idToCaller;
    mapping(bytes32=> bytes) public messageIdToData;
    mapping(bytes32=> bool) public didPush;
    bytes4 private constant func_selector = bytes4(keccak256("getOracleSubmission(uint256)"));
    bytes32 public constant _requestSelector = 0x88b6c755140efe88bff94bfafa4a7fdffe226d27d92bd45385bb0cfa90986650; //ethCall
    event InfoRecieved(bytes32 _messageId, bool _status);
    event InfoRequest(uint256 _depositId);
    
    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address _ambBridge, address payable _tellor) UsingTellor(_tellor){
        ambBridge = IAMB(_ambBridge);
    }

    //sets charon on other chain
    function setCharon(address _connectedCharon, address _charon) external{
        require(connectedCharon == address(0));
        connectedCharon = _connectedCharon;
        charon = _charon;
    }

    function getInfo(uint256 _depositId)  external returns (bytes32 _messageId){
        require(connectedCharon != address(0));
        bytes memory _data = abi.encodeWithSelector(func_selector,_depositId);
        _data = abi.encode(connectedCharon,_data);
        _messageId = ambBridge.requireToGetInformation(_requestSelector,_data);
        idToCaller[_messageId] = msg.sender;
        emit InfoRequest(_depositId);
    }

    function onInformationReceived(bytes32 messageId,bool status,bytes calldata result) external{
        require(msg.sender == address(ambBridge));
        messageIdToData[messageId] = result;
        messageIds.push(messageId);
        emit InfoRecieved(messageId,status);
    }

    function getCommitment(bytes memory _inputData) external returns(bytes memory _value, address _caller){
        require(msg.sender == charon);
        bytes32 _messageId = _bytesToBytes32(_inputData);
        didPush[_messageId] = true;
        _caller = idToCaller[_messageId];
       _value = messageIdToData[_messageId];
    }

    /**
     * @dev grabs the oracle value from the tellor oracle
     * @param _timestamp timestamp to grab
     * @param _chainID chain to grab
     * @param _address address of the CIT token on mainnet Ethereum
     */
    function getRootHashAndSupply(uint256 _timestamp,uint256 _chainID, address _address) external view returns(bytes memory _value){
        bytes32 _queryId = keccak256(abi.encode("CrossChainBalance",abi.encode(_chainID,_address,_timestamp)));
        (_value,_timestamp) = getDataBefore(_queryId,block.timestamp - 12 hours);
        require(_timestamp > 0, "timestamp must be present");
    }

    function sendCommitment(bytes memory _data) external{
        //don't need to do anything, all on the read side
    }

    function _bytesToBytes32(bytes memory _b) internal pure returns (bytes32 _out) {
        for (uint256 _i = 0; _i < 32; _i++) {
            _out |= bytes32(_b[_i] & 0xFF) >> (_i * 8);
        }
    }

    function getMessageIds() external view returns(bytes32[] memory){
        return messageIds;
    }

}
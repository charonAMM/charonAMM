//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./extensions/FxBaseChildTunnel.sol";
import "usingtellor/contracts/UsingTellor.sol";

/**
 @title POLtoETHBridge
 @dev bridge contract on Polygon for connecting to the charon contract on Ethereum
 **/
contract POLtoETHBridge is UsingTellor, FxBaseChildTunnel{

    //storage
    address public charon;//charon contract address on this chain
    address public latestRootMessageSender;//last party to send
    uint256 public latestStateId;//last pushed ID
    uint256[] public stateIds;//list of stateIds pushed
    mapping(uint256 => bool) public didPush;
    mapping(uint256 => bytes) public stateIdToData;

    //events
    event MessageProcessed(uint256 _stateId, bytes _data);

    //functions
    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address payable _tellor, address _fxChild) FxBaseChildTunnel(_fxChild) UsingTellor(_tellor){}

    /**
     * @dev grabs the oracle value from the tellor oracle
     * @param _inputData the state Id you're trying to grab.  If null, grabs the most recent one not pushed over. 
     * @return _value bytes data returned from tellor
     */
    function getCommitment(bytes memory _inputData) external returns(bytes memory _value, address){
        require(msg.sender == charon);
        uint256 _stateId = _bytesToUint(_inputData);
        didPush[_stateId] = true;
        return (stateIdToData[_stateId],address(0));
    }

    /**
     * @dev function to emit an event which will send a message to the root chain
     * @param _data bytes info to send accross
     */
    function sendCommitment(bytes memory _data) external{
        require(msg.sender == charon);
        _sendMessageToRoot(_data);
    }

    /**
     * @dev initializes the contract by setting charon
     * @param _charon address of charon contract on this chain
     */
    function setCharon(address _charon) external{
        require(charon == address(0));
        charon = _charon;
    }

    //getters
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

    /**
     * @dev getter to grab the array of stateIds
     */
    function getStateIds() external view returns(uint256[] memory){
        return stateIds;
    }

    //internal
    /**
     * @dev internal function to convert bytes to a uint
     * @param _b bytes to convert
     */
    function _bytesToUint(bytes memory _b) internal pure returns (uint256 _n){
        for(uint256 _i=0;_i<_b.length;_i++){
            _n = _n + uint(uint8(_b[_i]))*(2**(8*(_b.length-(_i+1))));
        }
    }

    /**
     * @notice Process message received from Child Tunnel
     * @dev function needs to be implemented to handle message as per requirement
     * This is called by onStateReceive function.
     * Since it is called via a system call, any event will not be emitted during its execution.
     * @param _stateId unique state id
     * @param _sender root message sender
     * @param _data bytes message that was sent from Root Tunnel
     */
    function _processMessageFromRoot(
        uint256 _stateId,
        address _sender,
        bytes memory _data
    ) internal virtual override validateSender(_sender) {
        latestStateId = _stateId;
        stateIdToData[_stateId] = _data;
        latestRootMessageSender = _sender;
        stateIds.push(_stateId);
        emit MessageProcessed(_stateId, _data);
    }
}
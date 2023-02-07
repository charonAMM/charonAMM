//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "usingtellor/contracts/UsingTellor.sol";
import "./extensions/FxBaseChildTunnel.sol";

/**
 @title Oracle
 @dev oracle contract for use in the charon system implementing tellor
 **/
contract POLtoETHBridge is UsingTellor, FxBaseChildTunnel{

    uint256 public latestStateId;
    address public latestRootMessageSender;
    address public charon;
    uint256[] public stateIds;
    mapping(uint256 => bytes) stateIdToData;
    mapping(uint256 => bool) didPush;

    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address payable _tellor, address _fxChild) UsingTellor(_tellor) FxBaseChildTunnel(_fxChild){}

    /**
     * @notice Process message received from Root Tunnel
     * @dev function needs to be implemented to handle message as per requirement
     * This is called by onStateReceive function.
     * Since it is called via a system call, any event will not be emitted during its execution.
     * @param stateId unique state id
     * @param sender root message sender
     * @param data bytes message that was sent from Root Tunnel
     */
    function _processMessageFromRoot(
        uint256 stateId,
        address sender,
        bytes memory data
    ) internal override validateSender(sender) {
        latestStateId = stateId;
        stateIdToData[stateId] = data;
        latestRootMessageSender = sender;
        stateIds.push(stateId);
    }

    /**
     * @dev grabs the oracle value from the tellor oracle
     * @param _inputData the state Id you're trying to grab.  If null, grabs the most recent one not pushed over. 
     * @return _value bytes data returned from tellor
     */
    function getCommitment(bytes memory _inputData) public returns(bytes memory _value){
        uint256 _stateId = _bytesToUint(_inputData);
        didPush[_stateId] = true;
        return stateIdToData[_stateId];
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
        _sendMessageToRoot(_data);
    }

    function _bytesToUint(bytes memory _b) internal pure returns (uint256 _n){
        for(uint256 _i=0;_i<_b.length;_i++){
            _n = _n + uint(uint8(_b[_i]))*(2**(8*(_b.length-(_i+1))));
        }
    }

}
//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../bridges/POLtoETHBridge.sol";


contract MockPOLtoETHBridge is POLtoETHBridge{

    constructor(address payable _tellor, address _fxChild)
        POLtoETHBridge(_tellor, _fxChild){}

    function _processMessageFromRoot(
        uint256 _stateId,
        address _sender,
        bytes memory _data
    ) internal override{
        latestStateId = _stateId;
        stateIdToData[_stateId] = _data;
        latestRootMessageSender = _sender;
        stateIds.push(_stateId);
        emit MessageProcessed(_stateId, _data);
    }
    function processMessageFromRoot(uint256 stateId,address sender,bytes memory data) external override{
        _processMessageFromRoot(stateId,sender,data);
    }
}
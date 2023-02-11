//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../bridges/POLtoETHBridge.sol";


contract MockPOLtoETHBridge is POLtoETHBridge{

    constructor(address payable _tellor, address _fxChild)
        POLtoETHBridge(_tellor, _fxChild){}

    function _processMessageFromRoot(
        uint256 stateId,
        address sender,
        bytes memory data
    ) internal override{
        latestStateId = stateId;
        stateIdToData[stateId] = data;
        latestRootMessageSender = sender;
        stateIds.push(stateId);
    }
    function processMessageFromRoot(uint256 stateId,address sender,bytes memory data) external override{
        _processMessageFromRoot(stateId,sender,data);
    }
}
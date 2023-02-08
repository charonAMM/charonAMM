//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../bridges/POLtoETHBridge.sol";


contract MockPOLToETHBridge is POLtoETHBridge{

    constructor(address payable _tellor, address _fxChild)
        POLtoETHBridge(_tellor, _fxChild){}

    function processMessageFromRoot(uint256 stateId,address sender,bytes memory data) external override{
        _processMessageFromRoot(stateId,sender,data);
    }
}
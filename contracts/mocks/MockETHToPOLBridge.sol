//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../bridges/ETHtoPOLBridge.sol";


contract MockETHtoPOLBridge is ETHtoPOLBridge{

    constructor(address payable _tellor, address _checkpointManager, address _fxRoot, address _fxChildTunnel)
        ETHtoPOLBridge(_tellor,_checkpointManager,_fxRoot,_fxChildTunnel){}

    function receiveMessage(bytes memory _data) public override{
        _processMessageFromChild(_data);
    }

}
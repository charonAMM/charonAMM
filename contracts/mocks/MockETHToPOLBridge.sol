//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../bridges/ETHtoPOLBridge.sol";


contract MockETHtoPOLBridge is ETHtoPOLBridge{

    constructor(address payable _tellor, address _checkpointManager, address _fxRoot)
        ETHtoPOLBridge(_tellor,_checkpointManager,_fxRoot){}

    function getCommitment(bytes memory _inputData) override external view returns(bytes memory _value, address _caller){
        require(msg.sender == charon, "must be charon");
        bytes memory _message = _inputData;//_validateAndExtractMessage(_inputData);
        return (_message,address(0));
    }
}
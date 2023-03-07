//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "../bridges/GnosisAMB.sol";
import "../bridges/POLtoETHBridge.sol";
import "../bridges/ETHtoPOLBridge.sol";
/**
 @title MockNativeBridge
 **/
contract MockNativeBridge {

   //AMB Stuff

    GnosisAMB public amb;
    uint256 public lastBlock;
    POLtoETHBridge public p2e;
    ETHtoPOLBridge public e2p;
    address public fxChildTunnel;

    constructor(){
        fxChildTunnel = address(this);
    }

    function setUsers(address _amb, address _p2e, address _e2p) external{
        amb = GnosisAMB(_amb);
        p2e = POLtoETHBridge(_p2e);
        e2p = ETHtoPOLBridge(_e2p);
    }

    //fakeFunction to call on destinationChain once thing is passed
    function setAMBInfo(uint256 _depositId, bytes memory _data) external{
          amb.onInformationReceived(keccak256(abi.encode(_depositId)),true,_data);
    }

   //EthToPOL Stuff

   function sendMessageToChild(address _fxChildTunnel, bytes memory _message) external{
       require(_fxChildTunnel == fxChildTunnel);
       lastBlock = block.number;
       p2e.processMessageFromRoot(block.number,address(this), _message);
   }
}
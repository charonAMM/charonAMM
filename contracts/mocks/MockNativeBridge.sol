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

    mapping(uint256 => bytes) public depositIdToData;
    GnosisAMB public amb;
    POLtoETHBridge public p2e;
    ETHtoPOLBridge public e2p;
    address public fxChildTunnel;

    constructor(address _amb, address _fxChildTunnel, address _p2e, address _e2p){
        amb = GnosisAMB(_amb);
        fxChildTunnel = _fxChildTunnel;
        p2e = POLtoETHBridge(_p2e);
        e2p = ETHtoPOLBridge(_e2p);
    }

    //fakeFunction to call on destinationChain once thing is passed
    function setAMBInfo(uint256 _depositId, bytes memory _data) external{
        depositIdToData[_depositId] = _data;
    }

    function requireToGetInformation(bytes32 _requestSelector, bytes calldata _data) external{
        //it calls getOracleInfo for a specific depositID, so parse out the depositId from the _data and return the mapped value
        if(_requestSelector == 0x88b6c755140efe88bff94bfafa4a7fdffe226d27d92bd45385bb0cfa90986650){
            uint256 _depositId;
            (,_depositId) = abi.decode(_data,(bytes4,uint256));
            amb.onInformationReceived(keccak256(abi.encode(_depositId)),true,depositIdToData[_depositId]);
        }
    }

   //EthToPOL Stuff

   function sendMessageToChild(address _fxChildTunnel, bytes memory _message) external{
       require(_fxChildTunnel == fxChildTunnel);
       p2e.processMessageFromRoot(block.number,address(this), _message);
   }

    //PoltoETH

    function sendMessageToRoot(bytes memory _message) external{
        e2p.receiveMessage(_message);
    }
}
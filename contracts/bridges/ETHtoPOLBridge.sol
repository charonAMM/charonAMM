//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./extensions/FxBaseRootTunnel.sol";
import "usingtellor/contracts/UsingTellor.sol";

/**
 @title ETHtoPOLBridge
 @dev bridge contract on Ethereum for connecting to connected charon contract on Polygon
 **/
contract ETHtoPOLBridge is FxBaseRootTunnel,UsingTellor{

    address public charon;//charon address of the charon contract on this chain (ETH)

    /**
     * @dev constructor to launch contract 
     * @param _tellor address of tellor oracle contract on this chain
     */
    constructor(address payable _tellor, address _checkpointManager, address _fxRoot) 
        FxBaseRootTunnel(_checkpointManager, _fxRoot) UsingTellor(_tellor){}

    /**
     * @dev allows getCommitment for retrieving information from the connected chain
    //  * @param _inputData RLP encoded data of the reference tx containing following list of fields
    //  *  0 - headerNumber - Checkpoint header block number containing the reference tx
    //  *  1 - blockProof - Proof that the block header (in the child chain) is a leaf in the submitted merkle root
    //  *  2 - blockNumber - Block number containing the reference tx on child chain
    //  *  3 - blockTime - Reference tx block time
    //  *  4 - txRoot - Transactions root of block
    //  *  5 - receiptRoot - Receipts root of block
    //  *  6 - receipt - Receipt of the reference transaction
    //  *  7 - receiptProof - Merkle proof of the reference receipt
    //  *  8 - branchMask - 32 bits denoting the path of receipt in merkle tree
    //  *  9 - receiptLogIndex - Log Index to read from the receipt
     */
    function getCommitment(bytes memory _inputData) external virtual returns(bytes memory _value, address _caller){
        require(msg.sender == charon, "must be charon");
        bytes memory _message = _validateAndExtractMessage(_inputData);
        return (_message,address(0));
    }

    /**
     * @dev used by charon to send a commitment to the other chain
     * @param _data bytes data to send to the other chain
     */
    function sendCommitment(bytes memory _data) external{
        require(msg.sender == charon, "must be charon");
        _sendMessageToChild(_data);
    }

    /**
     * @dev sets the initial charon contract for bridge usage
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
}
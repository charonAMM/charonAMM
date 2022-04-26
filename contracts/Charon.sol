//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "usingtellor/contracts/UsingTellor.sol";

contract Charon is Token,usingTellor{

    IERC20 public token;
    IVerifier public verifier;
    uint256 public fee;
    mapping(uint256 => mapping(uint256 => bytes)) secretDepositInfo; //chainID to depositID to secretDepositInfo

    /**
     * @dev constructor to start
     * @param _address of token to be deposited
     */
    constructor(address _verifier,address _token, uint256 _fee, address _tellor) UsingTellor(_tellor) external{
        verifier = _verifier;
        token = _token;
        fee = _fee;
    }

    function lpDeposit(uint256 _amount) external{
        require(token.transferFrom(msg.sender,address(this),_amount));
        uint256 _calcAmount = ;
        _mint(msg.sender,_calcAmount);

    }

    function lpWithdraw() external{
       require(token.transfer(address(this),_amount));
       uint256 _calcAmount = ;
       _burn(_calcAmount;

    }

    //read Tellor, add the deposit to the pool and wait for withdraw
    function oracleDeposit(uint256 _chain, uint256 _depositId) external{
        bytes _depositInfo;
        bool _didGet;
        bytes32 _queryId = abi.encode("Charon",abi.encode(_chain,_depositId));
        (_didGet,depositInfo) =  getDataBefore(_queryId, now - 1 hours);//what should this timeframe be? (should be an easy verify)
        require(_didGet);
    }

    function secretDepositToOtherChain() externa returns(uint256 _depositId){

    }

    //withdraw your tokens (like a market order from the other chain)
    function secretWithdraw(
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund
  ) external payable nonReentrant {
    require(_fee <= denomination, "Fee exceeds transfer value");
    require(!nullifierHashes[_nullifierHash], "The note has been already spent");
    require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(
      verifier.verifyProof(
        _proof,
        [uint256(_root), uint256(_nullifierHash), uint256(_recipient), uint256(_relayer), _fee, _refund]
      ),
      "Invalid withdraw proof"
    );
    nullifierHashes[_nullifierHash] = true;
    _processWithdraw(_recipient, _relayer, _fee, _refund);
    emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);

    }

    function getDepositInfoForOracle(){

    }

}
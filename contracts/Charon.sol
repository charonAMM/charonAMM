//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "usingtellor/contracts/UsingTellor.sol";

contract Charon is usingTellor{

    IERC20 public token;
    uint256 public fee;
    mapping(uint256 => mapping(uint256 => bytes)) secretDepositInfo; //chainID to depositID to secretDepositInfo

    /**
     * @dev constructor to start
     * @param _address of token to be deposited
     */
    constructor(address _token, uint256 _fee, address _tellor) UsingTellor(_tellor) external{
        token = _token;
        fee = _fee;
    }

    function lpDeposit() external{

    }

    function lpWithdraw() external{

    }

    //read Tellor, add the deposit to the pool and wait for withdraw
    function oracleDeposit(uint256 _chain, uint256 _depositId) external{
        bytes _depositInfo;
        bool _didGet;
        bytes32 _queryId = abi.encode("Charon",abi.encode(_chain,_depositId));
        (_didGet,depositInfo) =  getDataBefore(_queryId, now - 1 hours);//what should this timeframe be? (should be an easy verify)
        require(_didGet);
    }

    function getDataBefore(bytes32 _queryId, uint256 _timestamp)
        public
        view
        returns (
            bool _ifRetrieve,
            bytes memory _value,
            uint256 _timestampRetrieved
        );

    function secretDepositToOtherChain() externa returns(uint256 _depositId){

    }

    //withdraw your tokens (like a market order from the other chain)
    function secretWithdraw(){

    }

    function getDepositInfoForOracle(){

    }

}
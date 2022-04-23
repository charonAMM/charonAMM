//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

contract Charon{

    IERC20 public token;
    uint256 public fee;

    /**
     * @dev constructor to start
     * @param _address of token to be deposited
     */
    constructor(address _token, uint256 _fee) external{
        token = _token;
        fee = _fee;
    }

    function lpDeposit() external{

    }

    function lpWithdraw() external{

    }

    //read Tellor, add the deposit to the pool and wait for withdraw
    function oracleDeposit(){

    }

    function secretDepositToOtherChain(){

    }

    //withdraw your tokens (like a market order from the other chain)
    function secretWithdraw(){

    }

    function getDepositInfoForOracle(){

    }

}
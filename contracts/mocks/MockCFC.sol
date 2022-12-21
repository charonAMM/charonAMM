 //SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

import "../interfaces/IERC20.sol";

/**
 @title MockCFC
 @dev a mock contract for interacting wit the CFC
 */
contract MockCFC{

    IERC20 public token;
    IERC20 public chd;

    constructor(address _token, address _chd){
        token = IERC20(_token);
        chd = IERC20(_chd);
    }

    function addFees(uint256 _amount, bool _isCHD) external{
        if(_isCHD){
            require(chd.transferFrom(msg.sender,address(this), _amount), "should transfer amount");
        }
        else{
            require(token.transferFrom(msg.sender,address(this), _amount), "should transfer amount");
        }
    }
}  



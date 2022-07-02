//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./helpers/Math.sol";

contract CHUSD is Token{
    
    address public charon;

    constructor(address _charon){
        charon = _charon;
    }

    function mintCHUSD(address _to, uint256 _amount) external{
        require(msg.sender == charon);
        _mint(_to,_amount);
    }

    function burnCHUSD(address _from, uint256 _amount) external{
        require(msg.sender == charon);
        _burn(_from, _amount);
    }
}
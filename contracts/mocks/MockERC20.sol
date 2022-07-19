//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "../CHUSD.sol";

/**
 @title MockERC20
 @dev mock token contract to allow minting and burning for testing
**/  
contract MockERC20 is CHUSD{

    constructor(address _charon,string memory _name, string memory _symbol) CHUSD(_charon,_name,_symbol){
    }

    function mint(address account, uint256 amount) external virtual {
        _mint(account,amount);
    }

    function burn(address account, uint256 amount) external virtual {
        _burn(account,amount);
    }
}

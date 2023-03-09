//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

import "./Token.sol";

/**
 @title chd
 @dev chd is the synthetic representation of deposits on other AMM's created by the charon system
**/    
contract CHD is Token{

    //Storage
    address public charon;//address of the charon contract
    //Events
    event CHDMinted(address _to, uint256 _amount);
    event CHDBurned(address _from, uint256 _amount);

    /**
     * @dev constructor to initialize contract and token
     */
    constructor(address _charon,string memory _name, string memory _symbol) Token(_name,_symbol){
        charon = _charon;
    }

    /**
     * @dev allows the charon contract to burn tokens of users
     * @param _from address to burn tokens of
     * @param _amount amount of tokens to burn
     */
    function burnCHD(address _from, uint256 _amount) external{
        require(msg.sender == charon);
        _burn(_from, _amount);
        emit CHDBurned(_from,_amount);
    }
    
    /**
     * @dev allows the charon contract to mint chd tokens
     * @param _to address to mint tokens to
     * @param _amount amount of tokens to mint
     */
    function mintCHD(address _to, uint256 _amount) external{
        require(msg.sender == charon);
        _mint(_to,_amount);
        emit CHDMinted(_to,_amount);
    }
}
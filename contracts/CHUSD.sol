//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./Token.sol";

/**
 @title chusd
 @dev chusd is the synthetic representation of deposits on other AMM's created by the charon system
**/    
contract CHUSD is Token{

    //Storage
    address public charon;//address of the charon contract
    //Events
    event CHUSDMinted(address _to, uint256 _amount);
    event CHUSDBurned(address _from, uint256 _amount);

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
     * @return bool of success
     */
    function burnCHUSD(address _from, uint256 _amount) external returns(bool){
        require(msg.sender == charon,"caller must be charon");
        _burn(_from, _amount);
        emit CHUSDBurned(_from,_amount);
        return true;
    }
    
    /**
     * @dev allows the charon contract to mint chusd tokens
     * @param _to address to mint tokens to
     * @param _amount amount of tokens to mint
     * @return bool of success
     */
    function mintCHUSD(address _to, uint256 _amount) external returns(bool){
        require(msg.sender == charon, "caller must be charon");
        _mint(_to,_amount);
        emit CHUSDMinted(_to,_amount);
        return true;
    }
}
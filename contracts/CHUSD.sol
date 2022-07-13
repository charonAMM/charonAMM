//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./Token.sol";

contract CHUSD is Token{
    
    address public charon;

    event CHUSDMinted(address _to, uint256 _amount);
    event CHUSDBurned(address _from, uint256 _amount);

    constructor(address _charon,string memory _name, string memory _symbol) Token(_name,_symbol){
        charon = _charon;
    }

    function mintCHUSD(address _to, uint256 _amount) external returns(bool){
        require(msg.sender == charon, "caller must be charon");
        _mint(_to,_amount);
        emit CHUSDMinted(_to,_amount);
        return true;
    }

    function burnCHUSD(address _from, uint256 _amount) external returns(bool){
        require(msg.sender == charon,"caller must be charon");
        _burn(_from, _amount);
        emit CHUSDBurned(_from,_amount);
        return true;
    }
}
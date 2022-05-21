//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./helpers/Math.sol";

contract Token is Math{

    string  private _name     = "Charon Token";
    string  private _symbol   = "C";
    uint8   private _decimals = 18;
    uint256 internal _totalSupply;
    mapping(address => uint) internal _balance;
    mapping(address => mapping(address=>uint)) internal _allowance;


    event Approval(address indexed _src, address indexed _dst, uint _amt);
    event Transfer(address indexed _src, address indexed _dst, uint _amt);

    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public view returns(uint8) {
        return _decimals;
    }

    function allowance(address src, address dst) external view returns (uint) {
        return _allowance[src][dst];
    }

    function balanceOf(address whom) external view returns (uint) {
        return _balance[whom];
    }

    function totalSupply() public view returns (uint) {
        return _totalSupply;
    }

    function approve(address dst, uint amt) external returns (bool) {
        _allowance[msg.sender][dst] = amt;
        emit Approval(msg.sender, dst, amt);
        return true;
    }

    function transfer(address dst, uint amt) external returns (bool) {
        _move(msg.sender, dst, amt);
        return true;
    }

    function transferFrom(address src, address dst, uint amt) external returns (bool) {
        require(msg.sender == src || amt <= _allowance[src][msg.sender], "ERR_BTOKEN_BAD_CALLER");
        _move(src, dst, amt);
        if (msg.sender != src) {
            _allowance[src][msg.sender] = _allowance[src][msg.sender] -  amt;
            emit Approval(msg.sender, dst, _allowance[src][msg.sender]);
        }
        return true;
    }

    function _mint(uint amt) internal {
        _balance[address(this)] = _balance[address(this)] + amt;
        _totalSupply = _totalSupply + amt;
        emit Transfer(address(0), address(this), amt);
    }

    function _burn(uint amt) internal {
        require(_balance[address(this)] >= amt, "ERR_INSUFFICIENT_BAL");
        _balance[address(this)] = _balance[address(this)] - amt;
        _totalSupply = _totalSupply - amt;
        emit Transfer(address(this), address(0), amt);
    }

    function _move(address _src, address _dst, uint _amt) internal {
        require(_balance[_src] >= _amt, "ERR_INSUFFICIENT_BAL");
        _balance[_src] = _balance[_src] - _amt;
        _balance[_dst] = _balance[_dst] + _amt;
        emit Transfer(_src, _dst, _amt);
    }
}
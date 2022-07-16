//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

contract Token{
    
    string  private tokenName;
    string  private tokenSymbol;
    uint256 internal supply;
    mapping(address => uint) balance;
    mapping(address => mapping(address=>uint)) userAllowance;

    event Approval(address indexed _src, address indexed _dst, uint _amt);
    event Transfer(address indexed _src, address indexed _dst, uint _amt);

    constructor(string memory _name, string memory _symbol){
        tokenName = _name;
        tokenSymbol = _symbol;
    }

    function name() public view returns (string memory) {
        return tokenName;
    }

    function symbol() public view returns (string memory) {
        return tokenSymbol;
    }

    function decimals() public pure returns(uint8) {
        return 18;
    }

    function allowance(address _src, address _dst) external view returns (uint256) {
        return userAllowance[_src][_dst];
    }

    function balanceOf(address _whom) external view returns (uint256) {
        return balance[_whom];
    }

    function totalSupply() public view returns (uint256) {
        return supply;
    }

    function approve(address _dst, uint _amt) external returns (bool) {
        userAllowance[msg.sender][_dst] = _amt;
        emit Approval(msg.sender, _dst, _amt);
        return true;
    }

    function transfer(address dst, uint amt) external returns (bool) {
        _move(msg.sender, dst, amt);
        return true;
    }

    function transferFrom(address src, address dst, uint amt) external returns (bool) {
        require(msg.sender == src || amt <= userAllowance[src][msg.sender], "ERR_BTOKEN_BAD_CALLER");
        _move(src, dst, amt);
        if (msg.sender != src) {
            userAllowance[src][msg.sender] = userAllowance[src][msg.sender] -  amt;
            emit Approval(msg.sender, dst, userAllowance[src][msg.sender]);
        }
        return true;
    }
    /**Internal Functions */
    function _mint(address _to,uint amt) internal {
        balance[_to] = balance[_to] + amt;
        supply = supply + amt;
        emit Transfer(address(0), _to, amt);
    }

    function _burn(address _to, uint amt) internal {
        require(balance[_to] >= amt, "ERR_INSUFFICIENT_BAL");
        balance[_to] = balance[_to] - amt;
        supply = supply - amt;
        emit Transfer(_to, address(0), amt);
    }

    function _move(address _src, address _dst, uint _amt) internal {
        require(balance[_src] >= _amt, "ERR_INSUFFICIENT_BAL");
        balance[_src] = balance[_src] - _amt;
        balance[_dst] = balance[_dst] + _amt;
        emit Transfer(_src, _dst, _amt);
    }
}
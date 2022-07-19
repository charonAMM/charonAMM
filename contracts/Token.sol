//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

/**
 @title Token
 @dev base ERC20 to act as token underlying CHUSD and pool tokens
 */
contract Token{

    /*Storage*/
    string  private tokenName;
    string  private tokenSymbol;
    uint256 internal supply;//totalSupply
    mapping(address => uint) balance;
    mapping(address => mapping(address=>uint)) userAllowance;//allowance

    /*Events*/
    event Approval(address indexed _src, address indexed _dst, uint _amt);
    event Transfer(address indexed _src, address indexed _dst, uint _amt);

    /*Functions*/
    /**
     * @dev Constructor to initialize token
     * @param _name of token
     * @param _symbol of token
     */
    constructor(string memory _name, string memory _symbol){
        tokenName = _name;
        tokenSymbol = _symbol;
    }

    /**
     * @dev allows a user to approve a spender of their tokens
     * @param _spender address of party granting approval
     * @param _amount amount of tokens to allow spender access
     */
    function approve(address _spender, uint256 _amount) external returns (bool) {
        userAllowance[msg.sender][_spender] = _amount;
        emit Approval(msg.sender, _spender, _amount);
        return true;
    }

    /**
     * @dev function to transfer tokens
     * @param _to destination of tokens
     * @param _amount of tokens
     */
    function transfer(address _to, uint256 _amount) external returns (bool) {
        _move(msg.sender, _to, _amount);
        return true;
    }

    /**
     * @dev allows a party to transfer tokens from an approved address
     * @param _from address source of tokens 
     * @param _to address destination of tokens
     * @param _amount uint256 amount of tokens
     */
    function transferFrom(address _from, address _to, uint256 _amount) external returns (bool) {
        require(msg.sender == _from || _amount <= userAllowance[_from][msg.sender], "not approved");
        _move(_from,_to,_amount);
        if (msg.sender != _from) {
            userAllowance[_from][msg.sender] = userAllowance[_from][msg.sender] -  _amount;
            emit Approval(msg.sender, _to, userAllowance[_from][msg.sender]);
        }
        return true;
    }

    //Getters
    /**
     * @dev retrieves standard token allowance
     * @param _src user who owns tokens
     * @param _dst spender (destination) of these tokens
     * @return uint256 allowance
     */
    function allowance(address _src, address _dst) external view returns (uint256) {
        return userAllowance[_src][_dst];
    }

    /**
     * @dev retrieves balance of token holder
     * @param _user address of token holder
     * @return uint256 balance of tokens
     */
    function balanceOf(address _user) external view returns (uint256) {
        return balance[_user];
    }
    
    /**
     * @dev retrieves token number of decimals
     * @return uint8 number of decimals (18 standard)
     */
    function decimals() public pure returns(uint8) {
        return 18;
    }

    /**
     * @dev retrieves name of token
     * @return string token name
     */
    function name() external view returns (string memory) {
        return tokenName;
    }

    /**
     * @dev retrieves symbol of token
     * @return string token sybmol
     */
    function symbol() public view returns (string memory) {
        return tokenSymbol;
    }

    function totalSupply() public view returns (uint256) {
        return supply;
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
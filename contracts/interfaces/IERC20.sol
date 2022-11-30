// SPDX-License-Identifier: None
pragma solidity ^0.8.0;

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    event Approval(address indexed _owner, address indexed _spender, uint256 _value);
    event Transfer(address indexed _from, address indexed _to, uint256 _value);
    function approve(address _spender, uint256 _amount) external returns (bool);
    function transfer(address _to, uint256 _amount) external returns (bool);
    function transferFrom(address _from,address _to,uint256 _amount) external returns (bool);
    function allowance(address _owner, address _spender) external view returns (uint256);
    function balanceOf(address _account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

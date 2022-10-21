// SPDX-License-Identifier: None
pragma solidity ^0.8.0;

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface ICharon {
    function addUserRewards(uint256 _amount,bool _isCHD) external;
    function addLPRewards(uint256 _amount,bool _isCHD) external;
    function getTokens() external view returns(address,address);
}

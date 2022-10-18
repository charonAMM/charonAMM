//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./Token.sol";

/**
 @title fees
 @dev pays out fees to the CFC and LP's
**/    
contract Fees is Token{

    address public controller;//finalizes contracts, generates fees, will be CFC
    uint256 lpRewardsBalance;
    uint256 rewardRate;
    uint256 accumulatedRewardPerShare;

    //add variables, 
    //rename variables where appropriate
    //run updateStakeandPayRewards everytime we get new pool tokens issued
    //add tests

    /**
     * @dev Constructor to initialize token
     * @param _name of token
     * @param _symbol of token
     */
    constructor(string memory _name, string memory _symbol) Token(_name,_symbol){}

    /**
     * @dev from the fee on the swap or just paid to this contract
     * @param _amount amount of tokens to fund contract with
     */
    function addLPRewards(uint256 _amount) public {
        require(token.transferFrom(msg.sender, address(this), _amount));
        _updateRewards();
        lpRewardsBalance += _amount;
        // update reward rate = real staking rewards balance / 30 days
        rewardRate =
            (lpRewardsBalance -
                ((accumulatedRewardPerShare * supply) /
                    1e18 -
                    totalRewardDebt)) /
            30 days;
    }

    function _distributeFee(address _token, uint256 _amount) internal{
        let _toLP = _amount/2;
        addLPRewards(_toLP);
        ERC20(_token).transfer(controller,_amount - _toLP);
    }

/**
     * @dev Updates accumulated staking rewards per staked token
     */
    function _updateRewards() internal {
        if (timeOfLastAllocation == block.timestamp) {
            return;
        }
        if (supply== 0 || rewardRate == 0) {
            timeOfLastAllocation = block.timestamp;
            return;
        }
        // calculate accumulated reward per token staked
        uint256 _newAccumulatedRewardPerShare = accumulatedRewardPerShare +
            ((block.timestamp - timeOfLastAllocation) * rewardRate * 1e18) /
            supply;
        // calculate accumulated reward with _newAccumulatedRewardPerShare
        uint256 _accumulatedReward = (_newAccumulatedRewardPerShare *
            supply) /
            1e18 -
            totalRewardDebt;
        if (_accumulatedReward >= lpRewardsBalance) {
            // if staking rewards run out, calculate remaining reward per staked
            // token and set rewardRate to 0
            uint256 _newPendingRewards = lpRewardsBalance -
                ((accumulatedRewardPerShare * supply) /
                    1e18 -
                    totalRewardDebt);
            accumulatedRewardPerShare +=
                (_newPendingRewards * 1e18) /
                supply;
            rewardRate = 0;
        } else {
            accumulatedRewardPerShare = _newAccumulatedRewardPerShare;
        }
        timeOfLastAllocation = block.timestamp;
    }

    /**
     * @dev Called whenever a user's stake amount changes. First updates staking rewards,
     * transfers pending rewards to user's address, and finally updates user's stake amount
     * and other relevant variables.
     * @param _stakerAddress address of user whose stake is being updated
     * @param _newStakedBalance new staked balance of user
     */
    function _updateStakeAndPayRewards(
        address _stakerAddress,
        uint256 _newStakedBalance
    ) internal {
        _updateRewards();
        StakeInfo storage _staker = stakerDetails[_stakerAddress];
        if (_staker.stakedBalance > 0) {
            // if address already has a staked balance, calculate and transfer pending rewards
            uint256 _pendingReward = (_staker.stakedBalance *
                accumulatedRewardPerShare) /
                1e18 -
                _staker.rewardDebt;
            // get staker voting participation rate
            uint256 _numberOfVotes;
            (bool _success, bytes memory _returnData) = governance.call(
                abi.encodeWithSignature("getVoteCount()")
            );
            if (_success) {
                _numberOfVotes =
                    uint256(abi.decode(_returnData, (uint256))) -
                    _staker.startVoteCount;
            }
            if (_numberOfVotes > 0) {
                // staking reward = pending reward * voting participation rate
                (_success, _returnData) = governance.call(
                    abi.encodeWithSignature("getVoteTallyByAddress(address)",_stakerAddress)
                );
                if(_success){
                    uint256 _voteTally = abi.decode(_returnData,(uint256));
                    uint256 _tempPendingReward =
                        (_pendingReward *
                            (_voteTally - _staker.startVoteTally)) /
                        _numberOfVotes;
                    if (_tempPendingReward < _pendingReward) {
                        _pendingReward = _tempPendingReward;
                    }
                }
            }
            lpRewardsBalance -= _pendingReward;
            require(token.transfer(msg.sender, _pendingReward));
            totalRewardDebt -= _staker.rewardDebt;
            supply -= _staker.stakedBalance;
        }
        _staker.stakedBalance = _newStakedBalance;
        // Update total stakers
        if (_staker.stakedBalance >= stakeAmount) {
            if (_staker.staked == false) {
                totalStakers++;
            }
            _staker.staked = true;
        } else {
            if (_staker.staked == true && totalStakers > 0) {
                totalStakers--;
            }
            _staker.staked = false;
        }
        // tracks rewards accumulated before stake amount updated
        _staker.rewardDebt =
            (_staker.stakedBalance * accumulatedRewardPerShare) /
            1e18;
        totalRewardDebt += _staker.rewardDebt;
        supply += _staker.stakedBalance;
        // update reward rate if staking rewards are available 
        // given staker's updated parameters
        if(rewardRate == 0) {
            rewardRate =
            (lpRewardsBalance -
                ((accumulatedRewardPerShare * supply) /
                    1e18 -
                    totalRewardDebt)) /
            30 days;
        }
    }

    /**
     * @dev Internal function retrieves updated accumulatedRewardPerShare
     * @return uint256 up-to-date accumulated reward per share
     */
    function _getUpdatedAccumulatedRewardPerShare()
        internal
        view
        returns (uint256)
    {
        if (supply == 0) {
            return accumulatedRewardPerShare;
        }
        uint256 _newAccumulatedRewardPerShare = accumulatedRewardPerShare +
            ((block.timestamp - timeOfLastAllocation) * rewardRate * 1e18) /
            supply;
        uint256 _accumulatedReward = (_newAccumulatedRewardPerShare *
            supply) /
            1e18 -
            totalRewardDebt;
        if (_accumulatedReward >= lpRewardsBalance) {
            uint256 _newPendingRewards = lpRewardsBalance -
                ((accumulatedRewardPerShare * supply) /
                    1e18 -
                    totalRewardDebt);
            _newAccumulatedRewardPerShare =
                accumulatedRewardPerShare +
                (_newPendingRewards * 1e18) /
                supply;
        }
        return _newAccumulatedRewardPerShare;
    }




}
//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

/**
 @title MockMath
 @dev testing contract for the math contract contains amm math functions for the charon system
**/

contract CFC {

    struct FeePeriod{
        uint256 endDate;
        bytes32 rootHash;
        uint256 totalSupply;
        uint256 chdRewardsPerToken;
        uint256 baseTokenRewardsPerToken;
    }

    uint256 public toOracle;
    uint256 public toLPs;
    uint256 public toHolders;
    uint256 public toUsers;

    uint256 public toDistributeToken;
    uint256 public toDistributeCHD
    uint256[] public feePeriods;
    mapping(uint256 => FeePeriod) feePeriodByTimestamp; //gov token balance
    mapping(uint256 => uint256) rewardPerTokenByTimestamp;//reward per governanceToken at given timestamp

    address charon;
    address oracle;
    address oraclePayment;


    constructor(address _charon, address _oracle, address _oraclePayment, uint256 _toOracle, uint256 _toLPs, uint256 _toHolders, uint256 _toUsers){
        charon = _charon;
        oracle = _oracle;
        oraclePayment = _oraclePayment;
        toOracle = _toOracle;
        toLPs = _toLPs;
        toHolders = _toHolders;
        toUsers = _toUsers;
        _endDate = block.timestamp + 30 days;
        feePeriods.push(_endDate);
        feePeriodByTimestamp[_endDate].endDate = _endDate;

    }

    //to be called onceAMonth
    function endFeeRound(){
        FeePeriod _f = feePeriodByTimestamp[feePeriods[feePeriods.length - 1]];
        _getRootHashAndSupply(_f.endDate);
        _f.
        _endDate = block.timestamp + 30 days;
        feePeriods.push(_endDate);
        feePeriodByTimestamp[_endDate].endDate = _endDate;
        //both CHD and Token
        //sends to oracle
        //sends to governance token

    }

    function addFees(){

    }


    function acceptCharonFees(){
        //send the stuff going to LP's and users right back
        addLPRewards()
        addUserRewards()
    }

    function _getRootHashAndSupply(){
        //we need the rootHash and the totalSupply of the governanceToken
    }

    function claimRewards(){

    }

}
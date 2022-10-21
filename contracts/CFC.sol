//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./interfaces/IOracle.sol";
import "./interfaces/ICharon.sol";
import "./helpers/MerkleTree.sol";
import "./interfaces/IERC20.sol";
/**
 @title MockMath
 @dev testing contract for the math contract contains amm math functions for the charon system
**/
contract CFC is MerkleTree{

    struct FeePeriod{
        uint256 endDate;
        bytes32 rootHash;
        uint256 totalSupply;
        uint256 chdRewardsPerToken;
        uint256 baseTokenRewardsPerToken;
    }

    uint256 public toOracle;//amount in 100e18
    uint256 public toLPs;
    uint256 public toHolders;
    uint256 public toUsers;
    uint256 public toDistributeToken;
    uint256 public toDistributeCHD;
    uint256[] public feePeriods;
    mapping(uint256 => FeePeriod) feePeriodByTimestamp; //gov token balance
    ICharon public charon;
    IOracle public oracle;
    address public oraclePayment;
    IERC20 token;
    IERC20 chd;

    event FeeRoundEnded(uint256 _endDate, uint256 _baseTokenrRewardsPerToken, uint256 _chdRewardsPerToken);

    constructor(address _charon, address _oracle, address _oraclePayment, uint256 _toOracle, uint256 _toLPs, uint256 _toHolders, uint256 _toUsers){
        charon = ICharon(_charon);
        oracle = IOracle(_oracle);
        oraclePayment = _oraclePayment;
        toOracle = _toOracle;
        toLPs = _toLPs;
        toHolders = _toHolders;
        toUsers = _toUsers;
        uint256 _endDate = block.timestamp + 30 days;
        feePeriods.push(_endDate);
        feePeriodByTimestamp[_endDate].endDate = _endDate;
        (address _a, address _b) = charon.getTokens();
        token = IERC20(_b);
        chd = IERC20(_a);
    }

    //to be called onceAMonth
    function endFeeRound() external{
        FeePeriod storage _f = feePeriodByTimestamp[feePeriods[feePeriods.length - 1]];
        require(block.timestamp > _f.endDate, "round should be over");
        bytes memory _val = oracle.getRootHashAndSupply(_f.endDate);
        (bytes32 _rootHash, uint256 _totalSupply) = abi.decode(_val,(bytes32,uint256));
        uint256 _endDate = block.timestamp + 30 days;
        feePeriods.push(_endDate);
        feePeriodByTimestamp[_endDate].endDate = _endDate;
        _f.baseTokenRewardsPerToken = toDistributeToken * toHolders/100e18 / _totalSupply;
        _f.chdRewardsPerToken = toDistributeCHD * toHolders/100e18 / _totalSupply;
        //CHD transfers
        uint256 _toOracle = toDistributeCHD * toOracle / 100e18;
        chd.transfer(oraclePayment,_toOracle);
        _toOracle = toDistributeToken * toOracle / 100e18;
        token.transfer(oraclePayment, _toOracle);
        toDistributeToken = 0;
        toDistributeCHD = 0;
        emit FeeRoundEnded(_f.endDate, _f.baseTokenRewardsPerToken, _f.chdRewardsPerToken);
    }

    function addFees(uint256 _amount, bool _isCHD) external{
        //send LP and User rewards over now
        uint256 _toLPs = _amount * toLPs / 100e18;
        uint256 _toUsers = _amount * toUsers / 100e18;
        _amount = _amount - _toLPs - _toUsers;
        if(_isCHD){
            require(chd.transferFrom(msg.sender,address(this), _amount), "should transfer amount");
            toDistributeCHD += _amount;
            charon.addUserRewards(_toUsers,true);
            charon.addLPRewards(_toLPs, true);
        }
        else{
            require(token.transferFrom(msg.sender,address(this), _amount), "should transfer amount");
            toDistributeToken += _amount;
            charon.addUserRewards(_toUsers,false);
            charon.addLPRewards(_toLPs, false);
        }
    }

    function claimRewards(uint256 _timestamp, address _account, uint256 _balance, bytes32[] calldata _hashes, bool[] calldata _right) external{
        bytes32 _rootHash = feePeriodByTimestamp[_timestamp].rootHash;
        bytes32 _myHash = keccak256(abi.encode(_account,_balance));
        if (_hashes.length == 1) {
            require(_hashes[0] == _myHash);
        } else {
            require(_hashes[0] == _myHash || _hashes[1] == _myHash);
        }
        require(InTree(_rootHash, _hashes, _right));
        //loop through both tokens and transfer based on share
    }

}
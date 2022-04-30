//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "usingtellor/contracts/UsingTellor.sol";
import "./interfaces/IERC20.sol";
import "./Token.sol";

contract Charon is Token,usingTellor{

    IERC20 public token1;
    IVerifier public verifier;
    uint256 public fee;
    address public controller;
    bool public finalized;
    bool private _mutex;
    mapping(address=>Record) private  _records;
    uint256 public totalWeight;

    mapping(uint256 => mapping(uint256 => bytes)) secretDepositInfo; //chainID to depositID to secretDepositInfo

    event LPDeposit(address _lp,uint256 _amount);

    modifier _lock_() {
        require(!_mutex, "ERR_REENTRY");
        _mutex = true;
        _;
        _mutex = false;
    }

    modifier _finalized_() {
      if(!finalized){
        require(msg.sender == controller);
      }
      _;
    }

    /**
     * @dev constructor to start
     * @param _address of token to be deposited
     */
    constructor(address _verifier,address _token, uint256 _fee, address _tellor) UsingTellor(_tellor) external{
        verifier = _verifier;
        token = _token;
        fee = _fee;
        IVerifier _verifier,
        IHasher _hasher,
        uint256 _denomination,
        uint32 _merkleTreeHeight,
    }


    function lpDeposit(uint _tokenAmountIn, uint _minPoolAmountOut)
        external
        _lock_
        _finalized_
        returns (uint poolAmountOut)

    {        
        require(_records[tokenIn].bound, "ERR_NOT_BOUND");
        require(tokenAmountIn <= bmul(_records[tokenIn].balance, MAX_IN_RATIO), "ERR_MAX_IN_RATIO");
        Record storage inRecord = _records[tokenIn];
        poolAmountOut = calcPoolOutGivenSingleIn(
                            inRecord.balance,
                            inRecord.denorm,
                            _totalSupply,
                            _totalWeight,
                            tokenAmountIn,
                            _swapFee
                        );
        require(poolAmountOut >= minPoolAmountOut, "ERR_LIMIT_OUT");
        inRecord.balance = badd(inRecord.balance, tokenAmountIn);
        emit LPDeposit(msg.sender,tokenAmountIn);
        _mint(poolAmountOut);
        _push(msg.sender, poolAmountOut);
        _pullUnderlying(token.address, msg.sender, tokenAmountIn);
        return poolAmountOut;
    }

    function lpWithdraw() _finalized_ external{
       require(token.transfer(address(this),_amount));
       uint256 _calcAmount = ;
       _burn(_calcAmount;

    }

    //read Tellor, add the deposit to the pool and wait for withdraw
    function oracleDeposit(uint256 _chain, uint256 _depositId) external{
        bytes _depositInfo;
        bool _didGet;
        bytes32 _queryId = abi.encode("Charon",abi.encode(_chain,_depositId));
        (_didGet,depositInfo) =  getDataBefore(_queryId, now - 1 hours);//what should this timeframe be? (should be an easy verify)
        require(_didGet);
    }

    function secretDepositToOtherChain() external _finalized_ returns(uint256 _depositId){

    }

    //withdraw your tokens (like a market order from the other chain)
    function secretWithdraw(
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund
    ) external payable _lock_  _finalized_{
    require(_fee <= denomination, "Fee exceeds transfer value");
    require(!nullifierHashes[_nullifierHash], "The note has been already spent");
    require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one
    require(
      verifier.verifyProof(
        _proof,
        [uint256(_root), uint256(_nullifierHash), uint256(_recipient), uint256(_relayer), _fee, _refund]
      ),
      "Invalid withdraw proof"
    );
    nullifierHashes[_nullifierHash] = true;
    _processWithdraw(_recipient, _relayer, _fee, _refund);
    emit Withdrawal(_recipient, _nullifierHash, _relayer, _fee);

    }

    function getDepositInfoForOracle(){

    }

    function bind(uint _balance)
        external
    {
        _records[token] = Record({
            balance: 0   // and set by `rebind`
        });
        rebind(token.address,_balance);
    }
    
    
    function rebind(address token, uint balance)
        public
        _logs_
        _lock_
        { 
        // Adjust the balance record and actual token balance
        uint oldBalance = _records[token].balance;
        _records[token].balance = balance;
        if (balance > oldBalance) {
            _pullUnderlying(token, msg.sender, bsub(balance, oldBalance));
        } else if (balance < oldBalance) {
            // In this case liquidity is being withdrawn, so charge EXIT_FEE
            uint tokenBalanceWithdrawn = bsub(oldBalance, balance);
            uint tokenExitFee = bmul(tokenBalanceWithdrawn, EXIT_FEE);
            _pushUnderlying(token, msg.sender, bsub(tokenBalanceWithdrawn, tokenExitFee));
            _pushUnderlying(token, _owner, tokenExitFee);
        }
    }

}
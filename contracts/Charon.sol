//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "usingtellor/contracts/UsingTellor.sol";
import "./interfaces/IERC20.sol";
import "./Token.sol";

contract Charon is Token,UsingTellor{

    IERC20 public token1;
    IVerifier public verifier;
    uint256 public fee;
    uint256 public denomination;
    uint32 public merkleTreeHeight;
    address public controller;
    bool public finalized;
    bool private _mutex;
    mapping(address=>Record) private  _records;
    mapping(bytes32=>bool) public commitments;
    mapping(bytes32=>bool) public didDepositCommitment;
    bytes32[] public depositCommitments;
    uint256 public totalWeight;

    mapping(uint256 => mapping(uint256 => bytes)) secretDepositInfo; //chainID to depositID to secretDepositInfo

    event LPDeposit(address _lp,uint256 _amount);
    event LPWithdrawa(address _lp, uint256 _amount);
    event OracleDeposit(bytes32 _commitment,uint32 _insertedIndex,uint256 _timestamp);
    event DepositToOtherChain(bytes32 _commitment, uint256 _timestamp);

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
     */
    constructor(address _verifier,address _token, uint256 _fee, address _tellor, uint256 _denomination, uint32 _merkeTreeHeight) UsingTellor(_tellor) external{
        verifier = _verifier;
        token = _token;
        fee = _fee;
        IHasher _hasher;
        denomination = _denomination;
        merkleTreeHeight = _merkleTreeHeight;
    }


    function lpDeposit(uint _tokenAmountIn, uint _minPoolAmountOut)
        external
        _lock_
        _finalized_
        returns (uint poolAmountOut)

    {   
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
        inRecord.balance = inRecord.balance + tokenAmountIn;
        emit LPDeposit(msg.sender,tokenAmountIn);
        _mint(poolAmountOut);
        _move(address(this),msg.sender, poolAmountOut);
        _pullUnderlying(token.address, msg.sender, tokenAmountIn);
        return poolAmountOut;
    }

   function lpWithdraw(uint _poolAmountIn, uint _minAmountOut)
        external
        _finalized_
        _lock_
        returns (uint _tokenAmountOut)
    {
        Record storage outRecord = _records[tokenOut];
        _tokenAmountOut = calcSingleOutGivenPoolIn(
                            outRecord.balance,
                            outRecord.denorm,
                            _totalSupply,
                            _totalWeight,
                            poolAmountIn,
                            _swapFee
                        );
        outRecord.balance = outRecord.balance - tokenAmountOut;
        uint exitFee = poolAmountIn * fee;
        emit LOG_EXIT(msg.sender, tokenOut, tokenAmountOut);
        _move(msg.sender,address(this), poolAmountIn);
        _burn(poolAmountIn - exitFee);
        _move(address(this),_owner, exitFee);
        _pushUnderlying(tokenOut, msg.sender,_tokenAmountOut);
    }

    //read Tellor, add the deposit to the pool and wait for withdraw
    function oracleDeposit(uint256 _chain, uint256 _depositId) external{
        bytes _commitment;
        bool _didGet;
        bytes32 _queryId = abi.encode("Charon",abi.encode(_chain,_depositId));
        (_didGet,_commitment) =  getDataBefore(_queryId, now - 1 hours);//what should this timeframe be? (should be an easy verify)
        require(_didGet);
        uint32 insertedIndex = _insert(_commitment);
        commitments[_commitment] = true;
        emit OracleDeposit(_commitment, insertedIndex, block.timestamp);
    }

    function depositToOtherChain(bytes32 _commitment) external _finalized_ returns(uint256 _depositId){
        require(msg.value == 0, "ETH value is supposed to be 0 for ERC20 instance");
        didDepositCommitment[_commitment] = true;
        depositedCommitments.push(_commitment);
        token.transferFrom(msg.sender, address(this), denomination);
        emit DepositToOtherChain(_commitment, block.timestamp);
    }

    function getDepositCommitmentsByIndex(uint _index) external view returns(bytes32){
      return depositedCommitements[_index];
    }

    //withdraw your tokens (like a market order from the other chain)
    function secretWithdraw(
        bytes calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _fee,
        uint256 _refund,
        bool _lp //should we deposit as an LP or if false, place as a market order
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

    function bind(uint _balance) external {
        require(!finalized);//should not be finalized yet
        _records[token] = Record({
            balance: 0   // and set by `rebind`
        });
        rebind(token.address,_balance);
    }
    
    function finalize() external _lock_ {
        require(msg.sender == _controller, "ERR_NOT_CONTROLLER");
        require(!_finalized, "ERR_IS_FINALIZED");
        finalized = true;
        _mint(INIT_POOL_SUPPLY);
        _move(address(this),msg.sender, INIT_POOL_SUPPLY);
    }

    function rebind(address token, uint balance) public _lock_{ 
        // Adjust the balance record and actual token balance
        uint oldBalance = _records[token].balance;
        _records[token].balance = balance;
        if (balance > oldBalance) {
            _pullUnderlying(token, msg.sender, balance - oldBalance);
        } else if (balance < oldBalance) {
            // In this case liquidity is being withdrawn, so charge EXIT_FEE
            uint tokenBalanceWithdrawn = oldBalance - balance;
            uint tokenExitFee = tokenBalanceWithdrawn * EXIT_FEE;
            _pushUnderlying(token, msg.sender, tokenBalanceWithdrawn - tokenExitFee);
            _pushUnderlying(token, _owner, tokenExitFee);
        }
    }

/** @dev whether a note is already spent */
  function isSpent(bytes32 _nullifierHash) public view returns (bool) {
    return nullifierHashes[_nullifierHash];
  }

  /** @dev whether an array of notes is already spent */
  function isSpentArray(bytes32[] calldata _nullifierHashes) external view returns (bool[] memory spent) {
    spent = new bool[](_nullifierHashes.length);
    for (uint256 i = 0; i < _nullifierHashes.length; i++) {
      if (isSpent(_nullifierHashes[i])) {
        spent[i] = true;
      }
    }
  }

      // 'Underlying' token-manipulation functions make external calls but are NOT locked
    // You must `_lock_` or otherwise ensure reentry-safety
    function _pullUnderlying(address erc20, address from, uint amount) internal {
        require (IERC20(erc20).transferFrom(from, address(this), amount));
    }

    function _pushUnderlying(address erc20, address to, uint amount) internal {
        require(IERC20(erc20).transfer(to, amount));
    }


}
//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "usingtellor/contracts/UsingTellor.sol";
import "./helpers/MerkleTree.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IVerifier.sol";
import "./Token.sol";
import "hardhat/console.sol";

contract Charon is Token, UsingTellor, MerkleTree{

    IERC20 public token;
    IVerifier public verifier;
    uint256 public fee;//fee when liquidity is withdrawn
    uint256 public denomination;
    uint32 public merkleTreeHeight;
    address public controller;
    bool public finalized;
    bool private _mutex;
    uint256 public recordBalance;
    uint256 public recordBalanceSynth;
    mapping(bytes32 => bool) public nullifierHashes;
    mapping(bytes32=>bool) public commitments;
    mapping(bytes32=>bool) public didDepositCommitment;
    mapping(bytes32 => uint256) public depositIdByCommitment;
    bytes32[] public depositCommitments;
  
    event LPDeposit(address _lp,uint256 _amount);
    event LPWithdrawal(address _lp, uint256 _amount);
    event OracleDeposit(bytes32 _commitment,uint32 _insertedIndex,uint256 _timestamp);
    event DepositToOtherChain(bytes32 _commitment, uint256 _timestamp);
    event SecretLP(address _recipient,uint256 _poolAmountOut);
    event SecretMarketOrder(address _recipient, uint256 _tokenAmountOut);

    modifier _lock_() {
        require(!_mutex|| msg.sender == address(verifier));
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
    constructor(address _verifier,
                IHasher _hasher,
                address _token,
                uint256 _fee,
                address payable _tellor,
                uint256 _denomination,
                uint32 _merkleTreeHeight) 
              UsingTellor(_tellor) MerkleTree(_merkleTreeHeight, _hasher){
        verifier = IVerifier(_verifier);
        token = IERC20(_token);
        fee = _fee;
        denomination = _denomination;
        controller = msg.sender;
    }

    function bind(uint256 _balance, uint256 _synthBalance) public _lock_{ 
        require(!finalized, "must be finalized");//should not be finalized yet
        require(msg.sender == controller,"should be controler");
        recordBalance = _balance;
        recordBalanceSynth = _synthBalance;
        require (token.transferFrom(msg.sender, address(this), _balance));
    }

    function changeController(address _newController) external{
      controller = _newController;
    }

    function depositToOtherChain(bytes32 _commitment) external _finalized_ returns(uint256 _depositId){
        didDepositCommitment[_commitment] = true;
        depositCommitments.push(_commitment);
        _depositId = depositCommitments.length;
        depositIdByCommitment[_commitment] = _depositId;
        token.transferFrom(msg.sender, address(this), denomination);
        recordBalance += denomination;
        emit DepositToOtherChain(_commitment, block.timestamp);
    }

    function finalize() external _lock_ {
        require(msg.sender == controller, "ERR_NOT_CONTROLLER");
        require(!finalized, "ERR_IS_FINALIZED");
        finalized = true;
        _mint(INIT_POOL_SUPPLY);
        _move(address(this),msg.sender, INIT_POOL_SUPPLY);
    }

    function lpDeposit(uint _tokenAmountIn, uint _minPoolAmountOut)
        external
        _lock_
        _finalized_
        returns (uint256 _poolAmountOut)
    {   
        _poolAmountOut = calcPoolOutGivenSingleIn(
                            recordBalance,
                            1 ether,
                            _totalSupply,
                            2 ether,//totalWeight, we can later edit this part out of the math func
                            _tokenAmountIn,
                            fee
                        );
        recordBalance += _tokenAmountIn;
        require(_poolAmountOut >= _minPoolAmountOut, "not enough squeeze");
        _mint(_poolAmountOut);
        _move(address(this),msg.sender, _poolAmountOut);
        require (token.transferFrom(msg.sender,address(this), _tokenAmountIn));
        emit LPDeposit(msg.sender,_tokenAmountIn);
    }

   function lpWithdraw(uint256 _poolAmountIn, uint256 _minAmountOut)
        external
        _finalized_
        _lock_
        returns (uint256 _tokenAmountOut)
    {
        _tokenAmountOut = calcSingleOutGivenPoolIn(
                            recordBalance,
                            1 ether,
                            _totalSupply,
                            2 ether,
                            _poolAmountIn,
                            fee
                        );
        recordBalance -= _tokenAmountOut;
        require(_tokenAmountOut >= _minAmountOut, "not enough squeeze");
        uint exitFee = bmul(_poolAmountIn, fee);
        _move(msg.sender,address(this), _poolAmountIn);
        _burn(_poolAmountIn - exitFee);
        _move(address(this),controller, exitFee);//we need the fees to go to the LP's!!
        require(token.transfer(msg.sender, _tokenAmountOut));
    }


    //read Tellor, add the deposit to the pool and wait for withdraw
    function oracleDeposit(uint256 _chain, uint256 _depositId) external{
        bytes memory _value;
        bool _didGet;
        bytes32 _queryId = keccak256(abi.encode("Charon",abi.encode(_chain,_depositId)));
        (_didGet,_value,) =  getDataBefore(_queryId,block.timestamp - 1 hours);//what should this timeframe be? (should be an easy verify)
        require(_didGet);
        bytes32 _commitment = abi.decode(_value,(bytes32));
        console.log(iToHex(_value));
        console.log(bytes32ToString(_commitment));
        _commitment = bytes32(0x15b720a3a0d8e45b81cec236359855a5f506cac4499883439d4d7d1fb1d33ceb);
        //xconsole.log(iToHex(_commitment));
        uint32 _insertedIndex = _insert(_commitment);
        commitments[_commitment] = true;
        emit OracleDeposit(_commitment, _insertedIndex, block.timestamp);
    }

    function iToHex(bytes memory buffer) public pure returns (string memory) {
        // Fixed buffer size for hexadecimal convertion
        bytes memory converted = new bytes(buffer.length * 2);
        bytes memory _base = "0123456789abcdef";
        for (uint256 i = 0; i < buffer.length; i++) {
            converted[i * 2] = _base[uint8(buffer[i]) / _base.length];
            converted[i * 2 + 1] = _base[uint8(buffer[i]) % _base.length];
        }
        return string(abi.encodePacked("0x", converted));
    }

function bytes32ToString(bytes32 _bytes32) public pure returns (string memory) {
        uint8 i = 0;
        while(i < 32 && _bytes32[i] != 0) {
            i++;
        }
        bytes memory bytesArray = new bytes(i);
        for (i = 0; i < 32 && _bytes32[i] != 0; i++) {
            bytesArray[i] = _bytes32[i];
        }
        return string(bytesArray);
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
    ) external payable{//add finalized and lock?
      require(_fee <= denomination, "Fee exceeds transfer value");
      require(!nullifierHashes[_nullifierHash], "The note has been already spent");
      require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one
      // require(
      //   verifier.verifyProof(
      //     _proof,
      //     [uint256(_root), uint256(_nullifierHash),uint256(uint160(address(_recipient))), uint256(uint160(address(_relayer))), _fee, _refund]
      //   ),
      //   "Invalid withdraw proof"
      // );
      console.log("skipping verify");
      nullifierHashes[_nullifierHash] = true;
      require(msg.value == _refund, "Incorrect refund amount received by the contract");
      uint256 _tokenAmountIn = denomination - _fee;
      if(_lp){
          if(finalized){
            uint256 _poolAmountOut = calcPoolOutGivenSingleIn(
                              recordBalanceSynth,
                              1e18,
                              _totalSupply,
                              2e18,//we can later edit this part out of the math func
                              _tokenAmountIn,
                              fee
                          );
            emit LPDeposit(_recipient,_tokenAmountIn);
            _mint(_poolAmountOut);
            _move(address(this),_recipient, _poolAmountOut);
            emit SecretLP(_recipient,_poolAmountOut);
          }
          recordBalanceSynth += _tokenAmountIn;
      }
      else{
        //market order
          uint256 _spotPriceBefore = calcSpotPrice(
                                      recordBalanceSynth,
                                      100e18,
                                      recordBalance,
                                      100e18,
                                      fee
                                  );
          uint256 _tokenAmountOut = calcOutGivenIn(
                                      recordBalanceSynth,
                                      100e18,
                                      recordBalance,
                                      100e18,
                                      _tokenAmountIn,
                                      fee
                                  );
          recordBalance -= _tokenAmountOut;
          uint256 _spotPriceAfter = calcSpotPrice(
                                  recordBalanceSynth,
                                  100e18,
                                  recordBalance,
                                  100e18,
                                  fee
                              );
          require(_spotPriceAfter >= _spotPriceBefore, "ERR_MATH_APPROX");     
          require(_spotPriceBefore <=  bdiv(_tokenAmountIn,_tokenAmountOut), "ERR_MATH_APPROX");
          require(token.transfer(_recipient,_tokenAmountOut));
          emit SecretMarketOrder(_recipient,_tokenAmountOut);
      }
      if (_fee > 0) {
        token.transfer(_relayer, _fee);
      }
      if (_refund > 0) {
        (bool success, ) = _recipient.call{ value: _refund }("");
        if (!success) {
          // let's return _refund back to the relayer
          _relayer.transfer(_refund);
        }
      }
    }


    //GETTERS

    function getDepositCommitmentsById(uint256 _id) external view returns(bytes32){
      return depositCommitments[_id - 1];
    }

    function getDepositIdByCommitment(bytes32 _commitment) external view returns(uint){
      return depositIdByCommitment[_commitment];
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

  function _bytesToBytes32(bytes memory _b, uint8 _offset) internal pure returns (bytes32 _out) {
    for (uint8 _i = 0; _i < 32; _i++) {
      _out |= bytes32(_b[_offset + _i] & 0xFF) >> (_i * 8);
    }
  }
}
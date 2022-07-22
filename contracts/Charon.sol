//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./CHD.sol";
import "./MerkleTreeWithHistory.sol";
import "./Token.sol";
import "./helpers/Math.sol";
import "./helpers/Oracle.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IVerifier.sol";

/**
 @title charon
 @dev charon is a decentralized protocol for a Privacy Enabled Cross-Chain AMM (PECCAMM). 
 * it achieves privacy by breaking the link between deposits on one chain and withdrawals on another. 
 * it creates AMM's on multiple chains, but LP deposits in one of the assets and all orders are 
 * only achieved via depositing in alternate chains and then withdrawing as either an LP or market order.
 * to acheive cross-chain functionality, Charon utilizes tellor to pass commitments between chains.
//                                            /                                      
//                               ...      ,%##                                     
//                             /#/,/.   (%#*.                                     
//                            (((aaaa(   /%&,                                      
//                           #&##aaaa#   &#                                        
//                        /%&%%a&aa%%%#/%(*                                        
//                    /%#%&(&%&%&%&##%/%((                                         
//                  ,#%%/#%%%&#&###%#a&/((                                         
//                     (#(##%&a#&&%&a%(((%.                                ,/.    
//                     (/%&&a&&&#%a&(#(&&&/                             ,%%%&&%#,  
//                    ,#(&&&a&&&&aa%(#%%&&/                            *#%%%&%&%(  
//                   *##/%%aaaaaaa/&&&(&*&(/                           (#&%,%%&/   
//                 #((((#&#aaa&aa/#aaaaa&(#(                           /#%#,..  .  
//                  /##%(##aaa&&(#&a#&#&&a&(                           ,%&a//##,,* 
//               ,(#%###&((%aa%#&a&aa#&&#a#,                            %%%/,    . 
//               ,(#%/a#&#%&aa%&a&&a&(##/                               ##(a%##%## 
//                   *   %%(/%%&&a&&&%&#*                               #&&*#(,%&#&
//                      ((#&%&%##a#&%&&#,*                              .##(%a%aa( 
//                    .(#&##&%%%a%&%%((a&/.                              %&a%&(((*,
//                    *#%(%&%&&a&&&##&/,&a%(                            .%&%%&a&%/ 
//               ((((%%&(#%%%%a#&&(%&%%#/aa&(                           %&%#(#*(   
//             (%((&/#%##&%#%a(aa(%a&%&(*&a&/                         #%&&&%(#&/(  
//                (&aa#%a&&a%&aa/%a&&&%%#(a                         #&&&##%a/a%(/  
//            ///(%aa#%aa&%%aa&a(&a&a#&#(%a#                     (%%%&&a#&((&&%    
//             %aaaaa%&a&(&a&&##&&aa%(&&##%&#/           ,(((%%%%%%&%%&%##%&%.    
//   /(((//(* ,#%%#(&%a%&&&##(%%aa&a&##&%%&aaaaaaaa&(#%%%%#%&%%%%#%&%##%%#%#.     
//    ###(((##(//((#%a(////((#((#####(##%#(%&%#%%%#(%&&%%%%%#/%%%%(//%(##%%#       
//      /(##&%%#(((%&a%%#%#########%%%%%%%%%&%%%#%((#(%&%%(##(///%#%#%%&%#         
//        ,&aaaa&&%&&&a&&%#####%%%%%%%&%%&%#%##(#####(####%&##%&&&&&&&&#           
//   ////(%&&aaa(%aaaaaaaaaaa&aaaaaaaaaaaaaaaaaa&&&&a&a&a&aaaaaaaaa&              
//  (((((#(//(#%##%&&a&&&&aaa&&aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa%////(//,.       
//         ,##%%%%%%%%%%#%####(((/(%&&&&&&%%&&&&&aaaa&&aa&&&&&aaa&#%%%#///**%%(    
//                             ./%%%#%%%%%%%%%%%%%%%%%%%(((####%###((((#(*,,*(*    
//                                                   ,*#%%###(##########(((,    
*/
contract Charon is Math, MerkleTreeWithHistory, Oracle, Token{

    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    struct PartnerContract{
      uint256 chainID;
      address contractAddress;
    }

   struct ExtData {
    address recipient;
    int256 extAmount;
    address relayer;
    uint256 fee;
    bytes encryptedOutput1;
    bytes encryptedOutput2;
    bool isL1Withdrawal;
    uint256 l1Fee;
  }


    CHD public chd;
    IERC20 public token;//token deposited at this address
    IVerifier public verifier;
    PartnerContract[] partnerContracts;
    address public controller;//finalizes contracts, generates fees
    bool public finalized;
    bool private _mutex;//used for reentrancy protection
    bytes32[] public depositCommitments;//all commitments deposited by tellor in an array.  depositID is the position in array
    uint32 public merkleTreeHeight;
    uint256 public chainID; //chainID of this charon instance
    uint256 public denomination;//trade size in USD (1e18 decimals)
    uint256 public fee;//fee when liquidity is withdrawn or trade happens
    uint256 public recordBalance;//balance of asset stored in this contract
    uint256 public recordBalanceSynth;//balance of asset bridged from other chain
    mapping(bytes32=>bool) commitments;//commitments ready for withdrawal (or withdrawn)
    mapping(bytes32 => uint256) public depositIdByCommitment;//gives you a deposit ID (used by tellor) given a commitment
    mapping(bytes32=>bool) public didDepositCommitment;//tells you whether tellor deposited a commitment
    mapping(bytes32 => bool) public nullifierHashes;//zk proof hashes to tell whether someone withdrew

    //events
    event CharonFinalized(uint256[] _partnerChains,address[] _partnerAddys);
    event DepositToOtherChain(bool _isCHD, bytes32 _commitment, uint256 _timestamp, uint256 _tokenAmount);
    event LPDeposit(address _lp,uint256 _poolAmountOut);
    event LPWithdrawal(address _lp, uint256 _poolAmountIn);
    event OracleDeposit(bytes32[] _commitment,uint32[] _insertedIndices,uint256 _timestamp);

    //modifiers
    /**
     * @dev prevents reentrancy in function
    */
    modifier _lock_() {
        require(!_mutex|| msg.sender == address(verifier));
        _mutex = true;_;_mutex = false;
    }

    /**
     * @dev requires a function to be finalized or the caller to be the controlller
    */
    modifier _finalized_() {
      if(!finalized){require(msg.sender == controller);}_;
    }

    /**
     * @dev constructor to launch charon
     * @param _verifier address of the verifier contract (circom generated sol)
     * @param _hasher address of the hasher contract (mimC precompile)
     * @param _token address of token on this chain of the system
     * @param _fee fee when withdrawing liquidity or trading (pct of tokens)
     * @param _oracle address of oracle contract
     * @param _denomination size of deposit/withdraw in _token
     * @param _merkleTreeHeight merkleTreeHeight (should match that of circom compile)
     * @param _chainID chainID of this chain
     * @param _name name of pool token
     * @param _symbol of pool token
     */
    constructor(address _verifier,
                address _hasher,
                address _token,
                uint256 _fee,
                address payable _oracle,
                uint256 _denomination,
                uint32 _merkleTreeHeight,
                uint256 _chainID,
                string memory _name,
                string memory _symbol
                )
              MerkleTreeWithHistory(_merkleTreeHeight, _hasher)
              Oracle(_oracle)
              Token(_name,_symbol){
        require(_fee < _denomination,"fee should be less than denomination");
        verifier = IVerifier(_verifier);
        token = IERC20(_token);
        fee = _fee;
        denomination = _denomination;
        controller = msg.sender;
        chainID = _chainID;
    }

    /**
     * @dev bind sets the initial balance in the contract for AMM pool
     * @param _balance balance of _token to initialize AMM pool
     * @param _synthBalance balance of token on other side of pool initializing pool (sets initial price)
     * @param _chd address of deployed chd token
     */
    function bind(uint256 _balance, uint256 _synthBalance, address _chd) external _lock_{ 
        require(!finalized, "must be finalized");
        require(msg.sender == controller,"should be controler");
        recordBalance = _balance;
        recordBalanceSynth = _synthBalance;
        chd = CHD(_chd);
        require (token.transferFrom(msg.sender, address(this), _balance));
        chd.mintCHD(address(this),_synthBalance);
    }

    /**
     * @dev Allows the controller to change their address
     * @param _newController new controller.  Should be DAO for recieving fees
     */
    function changeController(address _newController) external{
      require(msg.sender == controller,"should be controler");
      controller = _newController;
    }

    /**
     * @dev function for user to lock tokens for lp/trade on other chain
     * @param _commitment deposit commitment generated by zkproof
     * @param _isCHD whether deposit is CHD, false if base asset deposit
     * @return _depositId returns the depositId (position in commitment array)
     */
    function depositToOtherChain(bytes32 _commitment, bool _isCHD) external _finalized_ returns(uint256 _depositId){
        didDepositCommitment[_commitment] = true;
        depositCommitments.push(_commitment);
        _depositId = depositCommitments.length;
        depositIdByCommitment[_commitment] = _depositId;
        uint256 _tokenAmount;
        if (_isCHD){
          chd.burnCHD(msg.sender,denomination);
          _tokenAmount = denomination;
        }
        else{
          _tokenAmount = calcInGivenOut(recordBalance,recordBalanceSynth,denomination,0);
          require(token.transferFrom(msg.sender, address(this), _tokenAmount));
        }
        recordBalance += _tokenAmount;
        emit DepositToOtherChain(_isCHD, _commitment, block.timestamp, _tokenAmount);
    }

    /**
     * @dev Allows the controller to start the system
     * @param _partnerChains list of chainID's in this Charon system
     * @param _partnerAddys list of corresponding addresses of charon contracts on chains in _partnerChains
     */
    function finalize(uint256[] memory _partnerChains,address[] memory _partnerAddys) external _lock_ {
        require(msg.sender == controller, "should be controller");
        require(!finalized, "should be finalized");
        finalized = true;
        _mint(msg.sender,100 ether);
        require(_partnerAddys.length == _partnerChains.length, "length should be the same");
        for(uint256 _i; _i < _partnerAddys.length; _i++){
          partnerContracts.push(PartnerContract(_partnerChains[_i],_partnerAddys[_i]));
        } 
        emit CharonFinalized(_partnerChains,_partnerAddys);
    }

    /**
     * @dev Allows a user to deposit as an LP on this side of the AMM
     * @param _poolAmountOut amount of pool tokens to recieve
     * @param _maxCHDIn max amount of CHD to send to contract
     * @param _maxBaseAssetIn max amount of base asset to send in
     */
    function lpDeposit(uint256 _poolAmountOut, uint256 _maxCHDIn, uint256 _maxBaseAssetIn)
        external
        _lock_
        _finalized_
    {   
        uint256 _poolTotal = totalSupply();
        uint256 _ratio = bdiv(_poolAmountOut, _poolTotal);
        require(_ratio != 0, "ERR_MATH_APPROX");
        uint256 _baseAssetIn = bmul(_ratio, recordBalance);
        require(_baseAssetIn != 0, "ERR_MATH_APPROX");
        require(_baseAssetIn <= _maxBaseAssetIn, "ERR_LIMIT_IN");
        recordBalance = badd(recordBalance,_baseAssetIn);
        uint256 _CHDIn = bmul(_ratio, recordBalanceSynth);
        require(_CHDIn != 0, "ERR_MATH_APPROX");
        require(_CHDIn <= _maxCHDIn, "ERR_LIMIT_IN");
        recordBalanceSynth = badd(recordBalanceSynth,_CHDIn);
        _mint(msg.sender,_poolAmountOut);
        require (token.transferFrom(msg.sender,address(this), _baseAssetIn));
        require (chd.transferFrom(msg.sender,address(this), _CHDIn));
        emit LPDeposit(msg.sender,_poolAmountOut);
    }

    /**
     * @dev allows a user to single-side LP CHD 
     * @param _tokenAmountIn amount of CHD to deposit
     * @param _minPoolAmountOut minimum number of pool tokens you need out
     */
    function lpSingleCHD(uint256 _tokenAmountIn,uint256 _minPoolAmountOut) external _finalized_ _lock_{
        uint256 _poolAmountOut = calcPoolOutGivenSingleIn(
                            recordBalanceSynth,//pool tokenIn balance
                            supply,
                            _tokenAmountIn//amount of token In
                        );
        recordBalance += _tokenAmountIn;
        require(_poolAmountOut >= _minPoolAmountOut, "not enough squeeze");
        _mint(msg.sender,_poolAmountOut);
        require (chd.transferFrom(msg.sender,address(this), _tokenAmountIn));
        emit LPDeposit(msg.sender,_tokenAmountIn);
    }

    /**
     * @dev Allows an lp to withdraw funds
     * @param _poolAmountIn amount of pool tokens to transfer in
     * @param _minCHDOut min aount of chd you need out
     * @param _minBaseAssetOut min amount of base token you need out
     * @return _tokenAmountOut amount of tokens recieved
     */
    function lpWithdraw(uint _poolAmountIn, uint256 _minCHDOut, uint256 _minBaseAssetOut)
        external
        _finalized_
        _lock_
        returns (uint256 _tokenAmountOut)
    {
        uint256 _poolTotal = totalSupply();
        uint256 _exitFee = bmul(_poolAmountIn, fee);
        uint256 _pAiAfterExitFee = bsub(_poolAmountIn, _exitFee);
        uint256 _ratio = bdiv(_pAiAfterExitFee, _poolTotal);
        require(_ratio != 0, "ERR_MATH_APPROX");
        _burn(msg.sender,_poolAmountIn - _exitFee);
        _move(address(this),controller, _exitFee);//we need the fees to go to the LP's!!
        _tokenAmountOut = bmul(_ratio, recordBalance);
        require(_tokenAmountOut != 0, "ERR_MATH_APPROX");
        require(_tokenAmountOut >= _minBaseAssetOut, "ERR_LIMIT_OUT");
        recordBalance = bsub(recordBalance, _tokenAmountOut);
        uint256 _CHDOut = bmul(_ratio, recordBalanceSynth);
        require(_CHDOut != 0, "ERR_MATH_APPROX");
        require(_CHDOut >= _minCHDOut, "ERR_LIMIT_OUT");
        recordBalanceSynth = bsub(recordBalanceSynth, _CHDOut);
        require(token.transfer(msg.sender, _tokenAmountOut));
        require(chd.transfer(msg.sender, _CHDOut));
        emit LPWithdrawal(msg.sender, _poolAmountIn);
    }

    /**
     * @dev allows a user to single-side LP withdraw CHD 
     * @param _poolAmountIn amount of pool tokens to deposit
     * @param _minAmountOut minimum amount of CHD you need out
     */
    function lpWithdrawSingleCHD(uint256 _poolAmountIn, uint256 _minAmountOut) external _finalized_ _lock_{
        uint256 _tokenAmountOut = calcSingleOutGivenPoolIn(
                            recordBalanceSynth,
                            supply,
                            _poolAmountIn,
                            fee
                        );
        recordBalance -= _tokenAmountOut;
        require(_tokenAmountOut >= _minAmountOut, "not enough squeeze");
        uint256 _exitFee = bmul(_poolAmountIn, fee);
        _burn(msg.sender,_poolAmountIn - _exitFee);
        _move(address(this),controller, _exitFee);//we need the fees to go to the LP's!!
        require(chd.transfer(msg.sender, _tokenAmountOut));
    }


    /**
     * @dev reads tellor commitments to allow you to withdraw on this chain
     * @param _chain chain you're requesting your commitment from
     * @param _depositId depositId of deposit on that chain
     */
    function oracleDeposit(uint256[] memory _chain, uint256[] memory _depositId) external{
        bytes32[] memory _commitments  = new bytes32[](_chain.length);
        _commitments = getCommitments(_chain, _depositId);
        uint32[] memory _insertedIndices = new uint32[](_chain.length);
        uint32 _index;
        for(uint8 _i; _i < _commitments.length; _i++){
              _index = _insert(_commitments[_i]);
              _insertedIndices[_i] = _index;
              commitments[_commitments[_i]] = true;
        }
        emit OracleDeposit(_commitments, _insertedIndices, block.timestamp);
    }

    /**
     * @dev withdraw your tokens from deposit on alternate chain
     * @param _proof proof information from zkproof corresponding to commitment
     * @param _root root in merkle tree where you're commitment was deposited
     * @param _nullifierHash secret hash of your nullifier corresponding to deposit
     * @param _recipient address funds (pool tokens or base token) will be be sent
     * @param _relayer address of relayer pushing txn on chain (for anonymity)
     * @param _refund amount to pay relayer
     */
    function secretWithdraw(
        Proof calldata _proof,
        bytes32 _root,
        bytes32 _nullifierHash,
        address payable _recipient,
        address payable _relayer,
        uint256 _refund
    ) external payable _finalized_ _lock_{
      require(!nullifierHashes[_nullifierHash], "The note has been already spent");
      require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one
        require(
            verifier.verifyProof(
                _proof.a,
                _proof.b,
                _proof.c,
                [
                    chainID,
                    uint256(_root),
                    uint256(_nullifierHash),
                    uint256(uint160(address(_recipient))),
                    uint256(uint160(address(_relayer))),
                    _refund
                ]
            ),
            "Invalid withdraw proof"
        );
      chd.mintCHD(_recipient,denomination);
      nullifierHashes[_nullifierHash] = true;
      if (_refund > 0) {
        (bool _success, ) = _recipient.call{ value: _refund }("");
        if (!_success) {
          _relayer.transfer(_refund);
        }
      }
    }

    /**
     * @dev withdraw your tokens from deposit on alternate chain
     * @param _inIsCHD bool if token sending in is CHD
     * @param _tokenAmountIn amount of token to send in
     * @param _minAmountOut minimum amount of out token you need
     * @param _maxPrice max price you're willing to send the pool too
     */
    function swap(
        bool _inIsCHD,
        uint256 _tokenAmountIn,
        uint256 _minAmountOut,
        uint256 _maxPrice
    )
        external _finalized_ _lock_
        returns (uint256 _tokenAmountOut, uint256 _spotPriceAfter){
        uint256 _inRecordBal;
        uint256 _outRecordBal;
        if(_inIsCHD){
           _inRecordBal = recordBalanceSynth;
           _outRecordBal = recordBalance;
        } 
        else{
          _inRecordBal = recordBalance;
          _outRecordBal = recordBalanceSynth;
        }
        require(_tokenAmountIn <= bmul(_inRecordBal, MAX_IN_RATIO), "ERR_MAX_IN_RATIO");
        uint256 _spotPriceBefore = calcSpotPrice(
                                    _inRecordBal,
                                    _outRecordBal,
                                    fee
                                );
        require(_spotPriceBefore <= _maxPrice, "ERR_BAD_LIMIT_PRICE");
        _tokenAmountOut = calcOutGivenIn(
                            _inRecordBal,
                            _outRecordBal,
                            _tokenAmountIn,
                            fee
                        );
        require(_tokenAmountOut >= _minAmountOut, "ERR_LIMIT_OUT");
        require(_spotPriceBefore <= bdiv(_tokenAmountIn, _tokenAmountOut), "ERR_MATH_APPROX");
        if(_inIsCHD){
           _outRecordBal = bsub(_outRecordBal, _tokenAmountOut);
           require(chd.burnCHD(msg.sender,_tokenAmountIn));
           require(token.transfer(msg.sender,_tokenAmountOut));
           recordBalance -= _tokenAmountOut;
        } 
        else{
          _inRecordBal = badd(_inRecordBal, _tokenAmountIn);
          _outRecordBal = bsub(_outRecordBal, _tokenAmountOut);
          require(token.transferFrom(msg.sender,address(this), _tokenAmountOut));
          require(chd.transfer(msg.sender,_tokenAmountOut));
          recordBalance += _tokenAmountIn;
          recordBalanceSynth -= _tokenAmountOut;
        }
        _spotPriceAfter = calcSpotPrice(
                                _inRecordBal,
                                _outRecordBal,
                                fee
                            );
        require(_spotPriceAfter >= _spotPriceBefore, "ERR_MATH_APPROX");     
        require(_spotPriceAfter <= _maxPrice, "ERR_LIMIT_PRICE");
      }

        /** @dev Main function that allows deposits, transfers and withdrawal.
   */
  function transact(Proof memory _args, ExtData memory _extData) public {
    if (_extData.extAmount > 0) {
      // for deposits from L2
      token.transferFrom(msg.sender, address(this), uint256(_extData.extAmount));
      require(uint256(_extData.extAmount) <= maximumDepositAmount, "amount is larger than maximumDepositAmount");
    }

    _transact(_args, _extData);
  }


      function _transact(Proof memory _args, ExtData memory _extData) internal nonReentrant {
    require(isKnownRoot(_args.root), "Invalid merkle root");
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      require(!isSpent(_args.inputNullifiers[i]), "Input is already spent");
    }
    require(uint256(_args.extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
    require(_args.publicAmount == calculatePublicAmount(_extData.extAmount, _extData.fee), "Invalid public amount");
    require(verifyProof(_args), "Invalid transaction proof");

    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      nullifierHashes[_args.inputNullifiers[i]] = true;
    }

    if (_extData.extAmount < 0) {
      require(_extData.recipient != address(0), "Can't withdraw to zero address");
      if (_extData.isL1Withdrawal) {
        token.transferAndCall(
          omniBridge,
          uint256(-_extData.extAmount),
          abi.encodePacked(l1Unwrapper, abi.encode(_extData.recipient, _extData.l1Fee))
        );
      } else {
        token.transfer(_extData.recipient, uint256(-_extData.extAmount));
      }
    }
    if (_extData.fee > 0) {
      token.transfer(_extData.relayer, _extData.fee);
    }

    lastBalance = token.balanceOf(address(this));
    _insert(_args.outputCommitments[0], _args.outputCommitments[1]);
    emit NewCommitment(_args.outputCommitments[0], nextIndex - 2, _extData.encryptedOutput1);
    emit NewCommitment(_args.outputCommitments[1], nextIndex - 1, _extData.encryptedOutput2);
    for (uint256 i = 0; i < _args.inputNullifiers.length; i++) {
      emit NewNullifier(_args.inputNullifiers[i]);
    }
  }
  

    //getters
    /**
     * @dev allows you to find a commitment for a given depositId
     * @param _id deposidId of your commitment
     */
    function getDepositCommitmentsById(uint256 _id) external view returns(bytes32){
      return depositCommitments[_id - 1];
    }

    /**
     * @dev allows you to find a depositId for a given commitment
     * @param _commitment the commitment of your deposit
     */
    function getDepositIdByCommitment(bytes32 _commitment) external view returns(uint256){
      return depositIdByCommitment[_commitment];
    }

    /**
     * @dev returns the partner contracts in this charon system and their chains
     */
    function getPartnerContracts() external view returns(PartnerContract[] memory){
      return partnerContracts;
    }

    /**
     * @dev allows you to check the spot price of the token pair
     * @return _spotPrice uint256 price of the pair
     */
    function getSpotPrice() external view returns(uint256 _spotPrice){
      return calcSpotPrice(recordBalanceSynth,recordBalance, 0);
    }

    /**
     * @dev allows you to see check if a commitment is present
     * @param _commitment bytes32 deposit commitment
     */
    function isCommitment(bytes32 _commitment) external view returns(bool){
      return commitments[_commitment];
    }

    /**
     * @dev allows a user to see if their deposit has been withdrawn
     * @param _nullifierHash hash of nullifier identifying withdrawal
     */
    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
      return nullifierHashes[_nullifierHash];
    }

    /**
     * @dev allows you to see whether an array of notes has been spent
     * @param _nullifierHashes array of notes identifying withdrawals
     */
    function isSpentArray(bytes32[] calldata _nullifierHashes) external view returns (bool[] memory _spent) {
      _spent = new bool[](_nullifierHashes.length);
      for (uint256 _i = 0; _i < _nullifierHashes.length; _i++) {
        if (isSpent(_nullifierHashes[_i])) {
          _spent[_i] = true;
        }
      }
    }
}
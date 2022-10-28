//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./CHD.sol";
import "./MerkleTreeWithHistory.sol";
import "./Token.sol";
import "./helpers/Math.sol";
import "./interfaces/IOracle.sol";
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
contract Charon is Math, MerkleTreeWithHistory, Token{

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
    }

    struct Commitment{
      ExtData extData;
      Proof proof;
    }

    struct Proof {
      bytes proof;
      bytes32 root;
      uint256 extDataHash;
      uint256 publicAmount;
      bytes32[] inputNullifiers;
      bytes32[2] outputCommitments;
    }

    CHD public chd;
    IERC20 public token;//token deposited at this address
    IOracle public oracle;
    IVerifier public verifier2;
    IVerifier public verifier16;
    Commitment[] depositCommitments;//all commitments deposited by tellor in an array.  depositID is the position in array
    PartnerContract[] partnerContracts;//list of connected contracts for this deployment
    address public controller;
    bool public finalized;
    bool private mutex;//used for reentrancy protection
    uint32 public merkleTreeHeight;
    uint256 public chainID; //chainID of this charon instance
    uint256 public fee;//fee when liquidity is withdrawn or trade happens
    uint256 public recordBalance;//balance of asset stored in this contract
    uint256 public recordBalanceSynth;//balance of asset bridged from other chain
    uint256 public userRewards;
    uint256 public userRewardsCHD;
    mapping(bytes32 => uint256) public depositIdByCommitmentHash;//gives you a deposit ID (used by tellor) given a commitment
    mapping(bytes32 => bool) public nullifierHashes;//zk proof hashes to tell whether someone withdrew

    //events
    event ControllerChanged(address _newController);
    event DepositToOtherChain(bool _isCHD, address _sender, uint256 _timestamp, uint256 _tokenAmount);
    event LPDeposit(address _lp,uint256 _poolAmountOut);
    event LPWithdrawal(address _lp, uint256 _poolAmountIn);
    event LPWithdrawSingleCHD(address _lp,uint256 _tokenAmountOut);
    event NewCommitment(bytes32 _commitment, uint256 _index, bytes _encryptedOutput);
    event NewNullifier(bytes32 _nullifier);
    event OracleDeposit(uint256[] _chain, uint256[] _depositId);
    event Swap(address _user,bool _inIsCHD,uint256 _tokenAmountIn,uint256 _tokenAmountOut);

    //modifiers
    /**
     * @dev prevents reentrancy in function
    */
    modifier _lock_() {
        require(!mutex|| msg.sender == address(verifier2) || msg.sender == address(verifier16));
        mutex = true;_;mutex = false;
    }

    /**
     * @dev requires a function to be finalized or the caller to be the controlller
    */
    modifier _finalized_() {
      if(!finalized){require(msg.sender == controller);}_;
    }

    /**
     * @dev constructor to launch charon
     * @param _verifier2 address of the verifier contract (circom generated sol)
     * @param _verifier16 address of the verifier contract (circom generated sol)
     * @param _hasher address of the hasher contract (mimC precompile)
     * @param _token address of token on this chain of the system
     * @param _fee fee when withdrawing liquidity or trading (pct of tokens)
     * @param _oracle address of oracle contract
     * @param _merkleTreeHeight merkleTreeHeight (should match that of circom compile)
     * @param _chainID chainID of this chain
     * @param _name name of pool token
     * @param _symbol of pool token
     */
    constructor(address _verifier2,
                address _verifier16,
                address _hasher,
                address _token,
                uint256 _fee,
                address _oracle,
                uint32 _merkleTreeHeight,
                uint256 _chainID,
                string memory _name,
                string memory _symbol
                )
              MerkleTreeWithHistory(_merkleTreeHeight, _hasher)
              Token(_name,_symbol){
        verifier2 = IVerifier(_verifier2);
        verifier16 = IVerifier(_verifier16);
        token = IERC20(_token);
        fee = _fee;
        controller = msg.sender;
        chainID = _chainID;
        oracle = IOracle(_oracle);
    }

    //is called from the CFC.  Either adds to the recordBalance or recordBalanceSynth. 
    function addLPRewards(uint256 _amount,bool _isCHD) external{
      if(_isCHD){
        recordBalanceSynth += _amount;
        require(chd.transferFrom(msg.sender,address(this),_amount));
      }
      else{
        recordBalance += _amount;
        require(token.transferFrom(msg.sender,address(this),_amount));
      }
    }

    function addUserRewards(uint256 _amount, bool _isCHD) external{
      if(_isCHD){
         require(chd.transferFrom(msg.sender,address(this),_amount));
         userRewardsCHD += _amount;
      }
      else{
        require(token.transferFrom(msg.sender,address(this),_amount));
        userRewards += _amount;
      }
    }

    /**
     * @dev Allows the controller to change their address
     * @param _newController new controller.  Should be DAO for recieving fees
     */
    function changeController(address _newController) external{
      require(msg.sender == controller,"should be controller");
      controller = _newController;
      emit ControllerChanged(_newController);
    }

    /**
     * @dev function for user to lock tokens for lp/trade on other chain
     * @param _proofArgs proofArgs of deposit commitment generated by zkproof
     * @param _extData data pertaining to deposit
     * @param _isCHD whether deposit is CHD, false if base asset deposit
     * @return _depositId returns the depositId (position in commitment array)
     */
    function depositToOtherChain(Proof memory _proofArgs,ExtData memory _extData, bool _isCHD) external _finalized_ returns(uint256 _depositId){
        Commitment memory _c = Commitment(_extData,_proofArgs);
        depositCommitments.push(_c);
        _depositId = depositCommitments.length;
        bytes32 _hashedCommitment = keccak256(abi.encode(_proofArgs.proof,_proofArgs.publicAmount,_proofArgs.root));
        depositIdByCommitmentHash[_hashedCommitment] = _depositId;
        uint256 _tokenAmount;
        if (_isCHD){
          chd.burnCHD(msg.sender,uint256(_extData.extAmount));
        }
        else{
          _tokenAmount = calcInGivenOut(recordBalance,recordBalanceSynth,uint256(_extData.extAmount),0);
          require(token.transferFrom(msg.sender, address(this), _tokenAmount));
        }
        uint256 _min = userRewards / 1000;
        if(_min > 0){
          if (_min > _tokenAmount / 50){
            _min = _tokenAmount / 50;
          }
          require(token.transfer(msg.sender, _min));
          userRewards -= _min;
        }
        _min = userRewardsCHD / 1000;
        if(_min > 0){
          if (_min > _tokenAmount / 50){
            _min = _tokenAmount / 50;
          }
          require(chd.transfer(msg.sender, _min));
          userRewards -= _min;
        }
        recordBalance += _tokenAmount;
        emit DepositToOtherChain(_isCHD,msg.sender, block.timestamp, _tokenAmount);
    }

    /**
     * @dev Allows the controller to start the system
     * @param _partnerChains list of chainID's in this Charon system
     * @param _partnerAddys list of corresponding addresses of charon contracts on chains in _partnerChains
     * @param _balance balance of _token to initialize AMM pool
     * @param _synthBalance balance of token on other side of pool initializing pool (sets initial price)
     * @param _chd address of deployed chd token
     */
    function finalize(uint256[] memory _partnerChains,
                      address[] memory _partnerAddys,
                      uint256 _balance,
                      uint256 _synthBalance, 
                      address _chd) 
                      external _lock_ {
        require(msg.sender == controller, "should be controller");
        require(!finalized, "should be finalized");
        finalized = true;
        recordBalance = _balance;
        recordBalanceSynth = _synthBalance;
        chd = CHD(_chd);
        require (token.transferFrom(msg.sender, address(this), _balance));
        chd.mintCHD(address(this),_synthBalance);
        _mint(msg.sender,100 ether);
        require(_partnerAddys.length == _partnerChains.length, "length should be the same");
        for(uint256 _i; _i < _partnerAddys.length; _i++){
          partnerContracts.push(PartnerContract(_partnerChains[_i],_partnerAddys[_i]));
        } 
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
        uint256 _ratio = _bdiv(_poolAmountOut, supply);
        require(_ratio != 0, "ERR_MATH_APPROX");
        uint256 _baseAssetIn = _bmul(_ratio, recordBalance);
        require(_baseAssetIn != 0, "ERR_MATH_APPROX");
        require(_baseAssetIn <= _maxBaseAssetIn, "ERR_LIMIT_IN");
        recordBalance = recordBalance + _baseAssetIn;
        uint256 _CHDIn = _bmul(_ratio, recordBalanceSynth);
        require(_CHDIn != 0, "ERR_MATH_APPROX");
        require(_CHDIn <= _maxCHDIn, "ERR_LIMIT_IN");
        recordBalanceSynth = recordBalanceSynth + _CHDIn;
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
        uint256 _exitFee = _bmul(_poolAmountIn, fee);
        uint256 _pAiAfterExitFee = _bsub(_poolAmountIn, _exitFee);
        uint256 _ratio = _bdiv(_pAiAfterExitFee, supply);
        require(_ratio != 0, "ERR_MATH_APPROX");
        _burn(msg.sender,_poolAmountIn - _exitFee);
        _move(address(this),controller, _exitFee);//we need the fees to go to the LP's!!
        _tokenAmountOut = _bmul(_ratio, recordBalance);
        require(_tokenAmountOut != 0, "ERR_MATH_APPROX");
        require(_tokenAmountOut >= _minBaseAssetOut, "ERR_LIMIT_OUT");
        recordBalance = _bsub(recordBalance, _tokenAmountOut);
        uint256 _CHDOut = _bmul(_ratio, recordBalanceSynth);
        require(_CHDOut != 0, "ERR_MATH_APPROX");
        require(_CHDOut >= _minCHDOut, "ERR_LIMIT_OUT");
        recordBalanceSynth = _bsub(recordBalanceSynth, _CHDOut);
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
        uint256 _exitFee = _bmul(_poolAmountIn, fee);
        _burn(msg.sender,_poolAmountIn - _exitFee);
        _move(address(this),controller, _exitFee);//we need the fees to go to the LP's!!
        require(chd.transfer(msg.sender, _tokenAmountOut));
        emit LPWithdrawSingleCHD(msg.sender,_tokenAmountOut);
    }

    /**
     * @dev reads tellor commitments to allow you to withdraw on this chain
     * @param _chain chain you're requesting your commitment from
     * @param _depositId depositId of deposit on that chain
     */
    function oracleDeposit(uint256[] memory _chain, uint256[] memory _depositId) external{
        Proof memory _proof;
        ExtData memory _extData;
        bytes memory _value;
        require(_chain.length == _depositId.length, "must be same length");
        for(uint256 _i; _i< _chain.length; _i++){
          _value = oracle.getCommitment(_chain[_i], _depositId[_i]);
          _proof.inputNullifiers = new bytes32[](2);
          (_proof.inputNullifiers[0], _proof.inputNullifiers[1], _proof.outputCommitments[0], _proof.outputCommitments[1], _proof.proof) = abi.decode(_value,(bytes32,bytes32,bytes32,bytes32,bytes));
          _transact(_proof, _extData);
        }
        emit OracleDeposit(_chain,_depositId);
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
        require(_tokenAmountIn <= _bmul(_inRecordBal, MAX_IN_RATIO), "ERR_MAX_IN_RATIO");
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
        require(_spotPriceBefore <= _bdiv(_tokenAmountIn, _tokenAmountOut), "ERR_MATH_APPROX");
        if(_inIsCHD){
           _outRecordBal = _bsub(_outRecordBal, _tokenAmountOut);
           require(chd.burnCHD(msg.sender,_tokenAmountIn));
           require(token.transfer(msg.sender,_tokenAmountOut));
           recordBalance -= _tokenAmountOut;//this captures the 50% to LP's
           if(fee > 0){
             recordBalance -= _tokenAmountOut * fee/2;
             require(token.transfer(controller, fee/2));
           }
        } 
        else{
          _inRecordBal = _inRecordBal + _tokenAmountIn;
          _outRecordBal = _bsub(_outRecordBal, _tokenAmountOut);
          require(token.transferFrom(msg.sender,address(this), _tokenAmountIn));
          require(chd.transfer(msg.sender,_tokenAmountOut));
          recordBalance += _tokenAmountIn;
          recordBalanceSynth -= _tokenAmountOut;//this captures the 50% to LP's
          if(fee > 0){
             recordBalanceSynth -= _tokenAmountOut * fee/2;
             require(chd.transfer(controller, fee/2));
          }
        }
        _spotPriceAfter = calcSpotPrice(
                                _inRecordBal,
                                _outRecordBal,
                                fee
                            );
        require(_spotPriceAfter >= _spotPriceBefore, "ERR_MATH_APPROX");     
        require(_spotPriceAfter <= _maxPrice, "ERR_LIMIT_PRICE");
        emit Swap(msg.sender,_inIsCHD,_tokenAmountIn,_tokenAmountOut);
      }

  //lets you do secret transfers / withdraw + mintCHD
  function transact(Proof memory _args, ExtData memory _extData) external _finalized_ _lock_{
      int256 _publicAmount = _extData.extAmount - int256(_extData.fee);
      if(_publicAmount < 0){
        _publicAmount = int256(FIELD_SIZE - uint256(-_publicAmount));
      } 
      require(_args.publicAmount == uint256(_publicAmount), "Invalid public amount");
      require(isKnownRoot(_args.root), "Invalid merkle root");
      require(_verifyProof(_args), "Invalid transaction proof");
      require(uint256(_args.extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
       if (_extData.extAmount < 0){
        require(chd.mintCHD(_extData.recipient, uint256(-_extData.extAmount)));
      }
      if(_extData.fee > 0){
        require(token.transfer(_extData.relayer,_extData.fee));
      }
      _transact(_args, _extData);
  }

    //getters
    /**
     * @dev allows you to find a commitment for a given depositId
     * @param _id deposidId of your commitment
     */
    function getDepositCommitmentsById(uint256 _id) external view returns(Commitment memory){
      return depositCommitments[_id - 1];
    }

    /**
     * @dev allows you to find a depositId for a given commitment
     * @param _commitment the commitment of your deposit
     */
    function getDepositIdByCommitmentHash(bytes32 _commitment) external view returns(uint256){
      return depositIdByCommitmentHash[_commitment];
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

    function getTokens() external view returns(address _chd, address _token){
      return (address(chd), address(token));
    }

    /**
     * @dev allows a user to see if their deposit has been withdrawn
     * @param _nullifierHash hash of nullifier identifying withdrawal
     */
    function isSpent(bytes32 _nullifierHash) external view returns (bool) {
      return nullifierHashes[_nullifierHash];
    }

  //internal functions
    function _transact(Proof memory _args, ExtData memory _extData) internal{
      for (uint256 _i = 0; _i < _args.inputNullifiers.length; _i++) {
        require(!nullifierHashes[_args.inputNullifiers[_i]], "Input is already spent");
        nullifierHashes[_args.inputNullifiers[_i]] = true;
        emit NewNullifier(_args.inputNullifiers[_i]);
      }
      _insert(_args.outputCommitments[0], _args.outputCommitments[1]);
      emit NewCommitment(_args.outputCommitments[0], nextIndex - 2, _extData.encryptedOutput1);
      emit NewCommitment(_args.outputCommitments[1], nextIndex - 1, _extData.encryptedOutput2);
    }
  
  function _verifyProof(Proof memory _args) internal view returns (bool) {
    uint[2] memory _a;
    uint[2][2] memory _b;
    uint[2] memory _c;
    (_a,_b,_c) = abi.decode(_args.proof,(uint[2],uint[2][2],uint[2]));
    if (_args.inputNullifiers.length == 2) {
      return
        verifier2.verifyProof(
          _a,_b,_c,
          [
            uint256(_args.root),
            _args.publicAmount,
            chainID,
            uint256(_args.extDataHash),
            uint256(_args.inputNullifiers[0]),
            uint256(_args.inputNullifiers[1]),
            uint256(_args.outputCommitments[0]),
            uint256(_args.outputCommitments[1])
          ]
        );
    } else if (_args.inputNullifiers.length == 16) {
      return
        verifier16.verifyProof(
          _a,_b,_c,
          [
            uint256(_args.root),
            _args.publicAmount,
            chainID,
            uint256(_args.extDataHash),
            uint256(_args.inputNullifiers[0]),
            uint256(_args.inputNullifiers[1]),
            uint256(_args.inputNullifiers[2]),
            uint256(_args.inputNullifiers[3]),
            uint256(_args.inputNullifiers[4]),
            uint256(_args.inputNullifiers[5]),
            uint256(_args.inputNullifiers[6]),
            uint256(_args.inputNullifiers[7]),
            uint256(_args.inputNullifiers[8]),
            uint256(_args.inputNullifiers[9]),
            uint256(_args.inputNullifiers[10]),
            uint256(_args.inputNullifiers[11]),
            uint256(_args.inputNullifiers[12]),
            uint256(_args.inputNullifiers[13]),
            uint256(_args.inputNullifiers[14]),
            uint256(_args.inputNullifiers[15]),
            uint256(_args.outputCommitments[0]),
            uint256(_args.outputCommitments[1])
          ]
        );
    } else {
      revert("unsupported input count");
    }
  }
}
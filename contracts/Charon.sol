//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

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

    /*storage*/
    struct PartnerContract{
      uint256 chainID;//EVM chain ID
      address contractAddress;//contract address of partner contract on given chain
    }

    struct ExtData {
      address recipient;//party recieving CHD
      int256 extAmount;//amount being sent
      address relayer;//relayer of signed message (adds anonymity)
      uint256 fee;//fee given to relayer
      bytes encryptedOutput1;//encrypted UTXO output of txn
      bytes encryptedOutput2;//other encrypted UTXO of txn (must spend all in UTXO design)
    }

    struct Commitment{
      ExtData extData;
      Proof proof;
    }

    struct Proof {
      bytes proof;//proof generated by groth16.fullProve()
      bytes32 root;//root of the merkleTree that contains your commmitment
      uint256 extDataHash;//hash of extData (to prevent relayer tampering)
      uint256 publicAmount;//amount you expect out (extAmount - fee)
      bytes32[] inputNullifiers;//nullifiers of input UTXOs (hash of amount, keypair, blinding, index, etc.)
      bytes32[2] outputCommitments;//hash of amount,keypair, bindings of output UTXOs
    }

    CHD public chd;//address/implementation of chd token
    IERC20 public immutable token;//base token address/implementation for the charonAMM
    IOracle public immutable oracle;//address of the oracle to use for the system
    IVerifier public immutable verifier2; //implementation/address of the two input veriifier contract
    IVerifier public immutable verifier16;//implementation/address of the sixteen input veriifier contract
    Commitment[] depositCommitments;//all commitments deposited by tellor in an array.  depositID is the position in array
    PartnerContract[] partnerContracts;//list of connected contracts for this deployment
    address public controller;//controller adddress (used for initializing contracts, then should be CFC for accepting fees)
    bool public finalized;//bool if contracts are initialized
    uint256 public immutable chainID; //chainID of this charon instance
    uint256 public immutable fee;//fee when liquidity is withdrawn or trade happens
    uint256 public recordBalance;//balance of asset stored in this contract
    uint256 public recordBalanceSynth;//balance of asset bridged from other chain
    uint256 public userRewards;//amount of baseToken user rewards in contract
    uint256 public userRewardsCHD;//amount of chd user rewards in contract
    mapping(bytes32 => uint256) public depositIdByCommitmentHash;//gives you a deposit ID (used by tellor) given a commitment
    mapping(bytes32 => bool) public nullifierHashes;//zk proof hashes to tell whether someone withdrew

    //events
    event ControllerChanged(address _newController);
    event DepositToOtherChain(bool _isCHD, address _sender, uint256 _timestamp, uint256 _tokenAmount);
    event LPDeposit(address _lp,uint256 _poolAmountOut);
    event LPRewardAdded(uint256 _amount,bool _isCHD);
    event LPWithdrawal(address _lp, uint256 _poolAmountIn);
    event NewCommitment(bytes32 _commitment, uint256 _index, bytes _encryptedOutput);
    event NewNullifier(bytes32 _nullifier);
    event OracleDeposit(uint256 _chain,address _contract, uint256[] _depositId);
    event Swap(address _user,bool _inIsCHD,uint256 _tokenAmountIn,uint256 _tokenAmountOut);
    event UserRewardAdded(uint256 _amount,bool _isCHD);

    //modifiers
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

    /**
     * @dev allows the cfc (or anyone) to add LPrewards to the system
     * @param _amount uint256 of tokens to add
     * @param _isCHD bool if the token is chd (baseToken if false)
     */
    function addLPRewards(uint256 _amount,bool _isCHD) external{
      if(_isCHD){
        require(chd.transferFrom(msg.sender,address(this),_amount));
        recordBalanceSynth += _amount;
      }
      else{
        require(token.transferFrom(msg.sender,address(this),_amount));
        recordBalance += _amount;
      }
      emit LPRewardAdded(_amount, _isCHD);
    }

    /**
     * @dev allows the cfc (or anyone) to add user rewards to the system
     * @param _amount uint256 of tokens to add
     * @param _isCHD bool if the token is chd (baseToken if false)
     */
    function addUserRewards(uint256 _amount, bool _isCHD) external{
      if(_isCHD){
         require(chd.transferFrom(msg.sender,address(this),_amount));
         userRewardsCHD += _amount;
      }
      else{
        require(token.transferFrom(msg.sender,address(this),_amount));
        userRewards += _amount;
      }
      emit UserRewardAdded(_amount, _isCHD);
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
        uint256 _tokenAmount = 0;
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
          token.transfer(msg.sender, _min);
          userRewards -= _min;
        }
        _min = userRewardsCHD / 1000;
        if(_min > 0){
          if (_min > _tokenAmount / 50){
            _min = _tokenAmount / 50;
          }
          chd.transfer(msg.sender, _min);
          userRewardsCHD -= _min;
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
                      external{
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
        _finalized_
    {   
        uint256 _ratio = _bdiv(_poolAmountOut, supply);
        require(_ratio > 0, "should not be 0 for inputs");
        uint256 _baseAssetIn = _bmul(_ratio, recordBalance);
        require(_baseAssetIn <= _maxBaseAssetIn, "too big baseDeposit required");
        recordBalance = recordBalance + _baseAssetIn;
        uint256 _CHDIn = _bmul(_ratio, recordBalanceSynth);
        require(_CHDIn <= _maxCHDIn, "too big chd deposit required");
        recordBalanceSynth = recordBalanceSynth + _CHDIn;
        _mint(msg.sender,_poolAmountOut);
        require (token.transferFrom(msg.sender,address(this), _baseAssetIn));
        require(chd.transferFrom(msg.sender, address(this),_CHDIn));
        emit LPDeposit(msg.sender,_poolAmountOut);
    }

    /**
     * @dev allows a user to single-side LP CHD 
     * @param _tokenAmountIn amount of CHD to deposit
     * @param _minPoolAmountOut minimum number of pool tokens you need out
     */
    function lpSingleCHD(uint256 _tokenAmountIn,uint256 _minPoolAmountOut) external _finalized_{
        uint256 _poolAmountOut = calcPoolOutGivenSingleIn(
                            recordBalanceSynth,//pool tokenIn balance
                            supply,
                            _tokenAmountIn//amount of token In
                        );
        recordBalanceSynth += _tokenAmountIn;
        require(_poolAmountOut >= _minPoolAmountOut, "not enough squeeze");
        _mint(msg.sender,_poolAmountOut);
        require (chd.transferFrom(msg.sender,address(this), _tokenAmountIn));
        emit LPDeposit(msg.sender,_poolAmountOut);
    }

    /**
     * @dev Allows an lp to withdraw funds
     * @param _poolAmountIn amount of pool tokens to transfer in
     * @param _minCHDOut min aount of chd you need out
     * @param _minBaseAssetOut min amount of base token you need out
     * @return _tokenAmountOut amount of tokens recieved
     */
    function lpWithdraw(uint256 _poolAmountIn, uint256 _minCHDOut, uint256 _minBaseAssetOut)
        external
        _finalized_
        returns (uint256 _tokenAmountOut)
    {
        uint256 _exitFee = _bmul(_poolAmountIn, fee);
        uint256 _pAiAfterExitFee = _poolAmountIn - _exitFee;
        uint256 _ratio = _bdiv(_pAiAfterExitFee, supply);
        _burn(msg.sender,_poolAmountIn - _exitFee);
        _move(address(this),controller, _exitFee);//we need the fees to go to the LP's!!
        _tokenAmountOut = _bmul(_ratio, recordBalance);
        require(_tokenAmountOut != 0, "ERR_MATH_APPROX");
        require(_tokenAmountOut >= _minBaseAssetOut, "ERR_LIMIT_OUT");
        recordBalance = recordBalance - _tokenAmountOut;
        uint256 _CHDOut = _bmul(_ratio, recordBalanceSynth);
        require(_CHDOut != 0, "ERR_MATH_APPROX");
        require(_CHDOut >= _minCHDOut, "ERR_LIMIT_OUT");
        recordBalanceSynth = recordBalanceSynth - _CHDOut;
        require(token.transfer(msg.sender, _tokenAmountOut));
        require(chd.transfer(msg.sender, _CHDOut));
        emit LPWithdrawal(msg.sender, _poolAmountIn);
    }

   /**
     * @dev allows a user to single-side LP withdraw CHD 
     * @param _poolAmountIn amount of pool tokens to deposit
     * @param _minAmountOut minimum amount of CHD you need out
     */
    function lpWithdrawSingleCHD(uint256 _poolAmountIn, uint256 _minAmountOut) external _finalized_{
        uint256 _tokenAmountOut = calcSingleOutGivenPoolIn(
                            recordBalanceSynth,
                            supply,
                            _poolAmountIn,
                            fee
                        );
        recordBalanceSynth -= _tokenAmountOut;
        require(_tokenAmountOut >= _minAmountOut, "not enough squeeze");
        uint256 _exitFee = _bmul(_poolAmountIn, fee);
        _burn(msg.sender,_poolAmountIn - _exitFee);
        _move(address(this),controller, _exitFee);//we need the fees to go to the LP's!!
        require(chd.transfer(msg.sender, _tokenAmountOut));
        emit LPWithdrawal(msg.sender,_poolAmountIn);
    }

    /**
     * @dev reads tellor commitments to allow you to withdraw on this chain
     * @param _depositId depositId of deposit on that chain
    * @param _partnerIndex index of contract in partnerContracts array
     */
    function oracleDeposit(uint256[] memory _depositId,uint256 _partnerIndex) external{
        Proof memory _proof;
        ExtData memory _extData;
        bytes memory _value;
        PartnerContract storage _p = partnerContracts[_partnerIndex];
        for(uint256 _i; _i<=_depositId.length-1; _i++){
          _value = oracle.getCommitment(_p.chainID, _p.contractAddress, _depositId[_i]);
          _proof.inputNullifiers = new bytes32[](2);
          (_proof.inputNullifiers[0], _proof.inputNullifiers[1], _proof.outputCommitments[0], _proof.outputCommitments[1], _proof.proof) = abi.decode(_value,(bytes32,bytes32,bytes32,bytes32,bytes));
          _transact(_proof, _extData);
        }
        emit OracleDeposit(_p.chainID,_p.contractAddress,_depositId);
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
        external _finalized_
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
        _outRecordBal = _outRecordBal - _tokenAmountOut;
        if(_inIsCHD){
           require(chd.burnCHD(msg.sender,_tokenAmountIn));
           require(token.transfer(msg.sender,_tokenAmountOut));
           recordBalance -= _tokenAmountOut;
           if(fee > 0){
             recordBalance -= _tokenAmountOut * fee/2;//this captures the 50% to LP's
             require(token.transfer(controller, fee/2));
           }
        } 
        else{
          _inRecordBal = _inRecordBal + _tokenAmountIn;
          require(token.transferFrom(msg.sender,address(this), _tokenAmountIn));
          require(chd.transfer(msg.sender,_tokenAmountOut));
          recordBalance += _tokenAmountIn;
          recordBalanceSynth -= _tokenAmountOut;
          if(fee > 0){
             recordBalanceSynth -= _tokenAmountOut * fee/2;//this captures the 50% to LP's
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

      /**
      * @dev allows users to send chd anonymously
      * @param _args proof data for sneding tokens
      * @param _extData external (visible data) to verify proof and pay relayer fee
      */
      function transact(Proof memory _args, ExtData memory _extData) external _finalized_{
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
          require(chd.mintCHD(_extData.relayer,_extData.fee));
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
     * @dev returns the data for an oracle submission on another chain given a depositId
     */
    function getOracleSubmission(uint256 _depositId) external view returns(bytes memory _value){
      Proof memory _p = depositCommitments[_depositId-1].proof;
      _value = abi.encode(
        _p.inputNullifiers[0],
        _p.inputNullifiers[1],
        _p.outputCommitments[0],
        _p.outputCommitments[1],
        _p.proof);
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
     * @dev allows you to check the token pair addresses of the pool
     * @return _chd address of chd token
     * @return _token address of baseToken
     */
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
    /**
     * @dev internal logic of secret transfers and chd mints
     * @param _args proof data for sneding tokens
     * @param _extData external (visible data) to verify proof and pay relayer fee
     */
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

    /**
     * @dev internal fucntion for verifying proof's for secret txns
     * @param _args proof data for seending tokens
     * @return bool of whether proof is verified
     */
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
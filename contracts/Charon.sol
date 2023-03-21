//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.17;

import "./CHD.sol";
import "./MerkleTreeWithHistory.sol";
import "./Token.sol";
import "./helpers/Math.sol";
import "./interfaces/ICFC.sol";
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
      uint256 fee;//fee given to relayer
      uint256 rebate;//amount taken from relayer and given to recipient
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
    Commitment[] depositCommitments;//all commitments deposited by tellor in an array.  depositID is the position in array
    IERC20 public immutable token;//base token address/implementation for the charonAMM
    IVerifier public immutable verifier2; //implementation/address of the two input veriifier contract
    IVerifier public immutable verifier16;//implementation/address of the sixteen input veriifier contract
    PartnerContract[] partnerContracts;//list of connected contracts for this deployment
    address public controller;//controller adddress (used for initializing contracts, then should be CFC for accepting fees)
    address[] oracles;//address of the oracle to use for the system
    bool private _lock;//to prevent reentracy
    uint256 public immutable chainID; //chainID of this charon instance
    uint256 public immutable fee;//fee when liquidity is withdrawn or trade happens (1e18 = 100% fee)
    uint256 public oracleTokenFunds;//amount of token funds to be paid to reporters
    uint256 public oracleCHDFunds;//amount of chd funds to be paid to reporters
    uint256 public recordBalance;//balance of asset stored in this contract
    uint256 public recordBalanceSynth;//balance of asset bridged from other chain
    uint256 public userRewards;//amount of baseToken user rewards in contract
    uint256 public userRewardsCHD;//amount of chd user rewards in contract
    uint256 public singleCHDLPToDrip;//amount to drip over next day
    uint256 public lastDrip;
    uint256 public dripRate;
    mapping(address => uint256) public singleLockTime;
    mapping(bytes32 => bool) nullifierHashes;//zk proof hashes to tell whether someone withdrew
    mapping(bytes32 => uint256) depositIdByCommitmentHash;//gives you a deposit ID (used by tellor) given a commitment
   

    //events
    event DepositToOtherChain(bool _isCHD, address _sender, uint256 _depositId, int256 _amount);
    event LPDeposit(address _lp,uint256 _poolAmountOut);
    event RewardAdded(uint256 _amount,bool _isCHD);
    event LPWithdrawal(address _lp, uint256 _poolAmountIn);
    event NewCommitment(bytes32 _commitment, uint256 _index, bytes _encryptedOutput, bool _isDeposit);
    event NewNullifier(bytes32 _nullifier);
    event OracleDeposit(uint256 _oracleIndex,bytes _inputData);
    event Swap(address _user,bool _inIsCHD,uint256 _tokenAmountIn,uint256 _tokenAmountOut);

    //functions
    /**
     * @dev constructor to launch charon
     * @param _verifier2 address of the verifier contract (circom generated sol)
     * @param _verifier16 address of the verifier contract (circom generated sol)
     * @param _hasher address of the hasher contract (mimC precompile)
     * @param _token address of token on this chain of the system
     * @param _fee fee when withdrawing liquidity or trading (pct of tokens)
     * @param _oracles address array of oracle contracts
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
                address[] memory _oracles,
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
        oracles = _oracles;
    }

    /**
     * @dev allows the cfc (or anyone) to add LPrewards to the system
     * @param _toUsers uint256 of tokens to add to Users
     * @param _toLPs uint256 of tokens to add to LPs
     * @param _toOracle uint256 of tokens to add to Oracle
     * @param _isCHD bool if the token is chd (baseToken if false)
     */
    function addRewards(uint256 _toUsers, uint256 _toLPs, uint256 _toOracle,bool _isCHD) external{
      require(_lock == false);
      if(_isCHD){
        require(chd.transferFrom(msg.sender,address(this),_toUsers + _toLPs + _toOracle));
        recordBalanceSynth += _toLPs;
        oracleCHDFunds += _toOracle;
        userRewardsCHD += _toUsers;
      }
      else{
        require(token.transferFrom(msg.sender,address(this),_toUsers + _toLPs + _toOracle));
        recordBalance += _toLPs;
        oracleTokenFunds += _toOracle;
        userRewards += _toUsers;
      }
      checkDrip();
      emit RewardAdded(_toUsers + _toLPs + _toOracle,_isCHD);
    }

    /**
     * @dev function to distribute singleCHDLPToDrip.  
     * note can only be done once per block
     * drip rate set in single LP depositCHD
     */
    function checkDrip() public {
      if(block.timestamp > lastDrip && singleCHDLPToDrip > 0){//only oncePerBlock
        lastDrip = block.timestamp;
        uint256 _amountToDrip =  dripRate;
        if(singleCHDLPToDrip < dripRate){
          _amountToDrip = singleCHDLPToDrip;
        }
        recordBalanceSynth += _amountToDrip;
        singleCHDLPToDrip -= _amountToDrip;
      }
    }

    /**
     * @dev function for user to lock tokens for lp/trade on other chain
     * @param _proofArgs proofArgs of deposit commitment generated by zkproof
     * @param _extData data pertaining to deposit
     * @param _isCHD whether deposit is CHD, false if base asset deposit
     * @param _maxOut max amount of token you're willing to spend on given CHD amount
     * @return _depositId returns the depositId (position in commitment array)
     */
    function depositToOtherChain(Proof memory _proofArgs,ExtData memory _extData, bool _isCHD, uint256 _maxOut) external returns(uint256 _depositId){
        require(_extData.extAmount > 0);
        require(_lock == false);
        depositCommitments.push(Commitment(_extData,_proofArgs));
        _depositId = depositCommitments.length;
        bytes32 _hashedCommitment = keccak256(abi.encode(_proofArgs.proof,_proofArgs.publicAmount,_proofArgs.root));
        depositIdByCommitmentHash[_hashedCommitment] = _depositId;
        uint256 _tokenAmount = calcInGivenOut(recordBalance,recordBalanceSynth,uint256(_extData.extAmount),0);
        if (_isCHD){
          chd.burnCHD(msg.sender,uint256(_extData.extAmount));
        }
        else{
          require(_tokenAmount <= _maxOut);
          require(token.transferFrom(msg.sender, address(this), _tokenAmount));
          recordBalance += _tokenAmount;
        }
        uint256 _min = userRewards / 1000;
        if(_min <= _tokenAmount && _min > 0){ 
          require(token.transfer(msg.sender, _min));
          userRewards -= _min;
        }
        _min = userRewardsCHD / 1000;
        if(_min <= _abs(_extData.extAmount) && _min > 0){
          chd.transfer(msg.sender, _min);
          userRewardsCHD -= _min;
        }
        for(uint256 _i = 0; _i<=oracles.length-1; _i++){
          IOracle(oracles[_i]).sendCommitment(getOracleSubmission(_depositId));
        }
        _transact(_proofArgs, _extData, true);//automatically adds your deposit to this chain (improve anonymity set)
        emit DepositToOtherChain(_isCHD, msg.sender, _depositId, _extData.extAmount);
    }

    /**
     * @dev Allows the controller to start the system
     * @param _partnerChains list of chainID's in this Charon system
     * @param _partnerAddys list of corresponding addresses of charon contracts on chains in _partnerChains
     * @param _balance balance of _token to initialize AMM pool
     * @param _synthBalance balance of token on other side of pool initializing pool (sets initial price)
     * @param _chd address of deployed chd token
     * @param _cfc address of cfc contract
     */
    function finalize(uint256[] memory _partnerChains,
                      address[] memory _partnerAddys,
                      uint256 _balance,
                      uint256 _synthBalance, 
                      address _chd,
                      address _cfc) 
                      external{
        require(msg.sender == controller);
        require(address(chd) == address(0));
        recordBalance = _balance;
        recordBalanceSynth = _synthBalance;
        chd = CHD(_chd);
        require(token.transferFrom(msg.sender, address(this), _balance));
        chd.mintCHD(address(this),_synthBalance);
        _mint(msg.sender,100 ether);
        for(uint256 _i; _i < _partnerAddys.length; _i++){
          partnerContracts.push(PartnerContract(_partnerChains[_i],_partnerAddys[_i]));
        } 
        controller = _cfc;
    }

    /**
     * @dev Allows a user to deposit as an LP on this side of the AMM
     * @param _poolAmountOut amount of pool tokens to recieve
     * @param _maxCHDIn max amount of CHD to send to contract
     * @param _maxBaseAssetIn max amount of base asset to send in
     */
    function lpDeposit(uint256 _poolAmountOut, uint256 _maxCHDIn, uint256 _maxBaseAssetIn)
        external
    {   
        require(_lock == false);
        uint256 _ratio = _bdiv(_poolAmountOut, supply);
        require(_ratio > 0);
        uint256 _baseAssetIn = _bmul(_ratio, recordBalance);
        require(_baseAssetIn <= _maxBaseAssetIn, "maxBaseAssetIn hit");
        recordBalance = recordBalance + _baseAssetIn;
        uint256 _CHDIn = _bmul(_ratio, recordBalanceSynth);
        require(_CHDIn <= _maxCHDIn, "maxCHDIn hit");
        recordBalanceSynth = recordBalanceSynth + _CHDIn;
        _mint(msg.sender,_poolAmountOut);
        require(token.transferFrom(msg.sender,address(this), _baseAssetIn));
        chd.transferFrom(msg.sender, address(this),_CHDIn);
        checkDrip();
        emit LPDeposit(msg.sender,_poolAmountOut);
    }

    /**
     * @dev allows a user to single-side LP CHD 
     * @param _tokenAmountIn amount of CHD to deposit
     * @param _minPoolAmountOut minimum number of pool tokens you need out
     */
    function lpSingleCHD(uint256 _tokenAmountIn,uint256 _minPoolAmountOut) external{
        require(_lock == false);
        uint256 _poolAmountOut = calcPoolOutGivenSingleIn(
                            recordBalanceSynth,//pool tokenIn balance
                            supply,
                            _tokenAmountIn//amount of token In
                        );
        singleCHDLPToDrip += _tokenAmountIn;
        dripRate = singleCHDLPToDrip / 1000;
        require(_poolAmountOut >= _minPoolAmountOut);
        _mint(msg.sender,_poolAmountOut);
        chd.transferFrom(msg.sender,address(this), _tokenAmountIn);
        singleLockTime[msg.sender] = block.timestamp + 24 hours;
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
        returns (uint256 _tokenAmountOut)
    {
        require(_lock == false);
        require(block.timestamp > singleLockTime[msg.sender]);
        checkDrip();
        uint256 _exitFee = _bmul(_poolAmountIn, fee);
        uint256 _pAiAfterExitFee = _poolAmountIn - _exitFee;
        uint256 _ratio = _bdiv(_pAiAfterExitFee, supply);
        _burn(msg.sender,_pAiAfterExitFee);//burning the total amount, but not taking out the tokens that are fees paid to the LP
        _tokenAmountOut = _bmul(_ratio, recordBalance);
        require(_tokenAmountOut != 0);
        require(_tokenAmountOut >= _minBaseAssetOut);
        recordBalance = recordBalance - _tokenAmountOut;
        uint256 _CHDOut = _bmul(_ratio, recordBalanceSynth);
        require(_CHDOut != 0);
        require(_CHDOut >= _minCHDOut);
        recordBalanceSynth = recordBalanceSynth - _CHDOut;
        require(token.transfer(msg.sender, _tokenAmountOut));
        chd.transfer(msg.sender, _CHDOut);
        emit LPWithdrawal(msg.sender, _poolAmountIn);
        //now transfer exit fee to CFC
        if(_exitFee > 0){
          _ratio = _bdiv(_exitFee, supply);
          _burn(msg.sender,_exitFee);//burning the total amount, but not taking out the tokens that are fees paid to the LP
          _tokenAmountOut = _bmul(_ratio, recordBalance);
          recordBalance = recordBalance - _tokenAmountOut;
          _CHDOut = _bmul(_ratio, recordBalanceSynth);
           recordBalanceSynth = recordBalanceSynth - _CHDOut;
          token.approve(address(controller),_tokenAmountOut);
          ICFC(controller).addFees(_tokenAmountOut,false);
          chd.approve(address(controller),_CHDOut);
          ICFC(controller).addFees(_CHDOut,true);
        }
    }

    /**
     * @dev reads tellor commitments to allow you to withdraw on this chain
     * @param _oracleIndex index of oracle in oracle array
    * @param _inputData depending on the bridge, it might be needed and lets you specify what you're pulling
     */
    function oracleDeposit(uint256 _oracleIndex, bytes memory _inputData) external{
        require(_lock == false);
        Proof memory _proof;
        ExtData memory _extData;
        bytes memory _value;
        address _caller;
        (_value,_caller) = IOracle(oracles[_oracleIndex]).getCommitment(_inputData);
        _proof.inputNullifiers = new bytes32[](2);
        (_proof.inputNullifiers[0], _proof.inputNullifiers[1], _proof.outputCommitments[0], _proof.outputCommitments[1], _proof.proof,_extData.encryptedOutput1, _extData.encryptedOutput2) = abi.decode(_value,(bytes32,bytes32,bytes32,bytes32,bytes,bytes,bytes));
        _transact(_proof, _extData, true);
        //you need this amount to be less than the stake amount, but if this is greater than the gas price to deposit and then report, you don't need to worry about it
        uint256 _funds;
        if(oracleCHDFunds > 2000){
          _funds = oracleCHDFunds/1000;
          oracleCHDFunds -= _funds;
          if(_caller != address(0)){
            _funds = _funds / 2;
            chd.transfer(_caller, _funds);
          }
          chd.transfer(msg.sender,_funds);
        }
        if(oracleTokenFunds > 2000){
          _funds = oracleTokenFunds/1000;
          oracleTokenFunds -= _funds;
          if(_caller != address(0)){
            _funds = _funds / 2;
            token.transfer(_caller, _funds);
          }
          token.transfer(msg.sender,_funds);
        }
        emit OracleDeposit(_oracleIndex, _inputData);
    }
  
    /**
     * @dev withdraw your tokens from deposit on alternate chain
     * @param _inIsCHD bool if token sending in is CHD
     * @param _tokenAmountIn amount of token to send in
     * @param _minAmountOut minimum amount of out token you need
     * @param _maxPrice max price you're willing to send the pool to
     */
    function swap(
        bool _inIsCHD,
        uint256 _tokenAmountIn,
        uint256 _minAmountOut,
        uint256 _maxPrice
    )
        external
        returns (uint256 _tokenAmountOut, uint256 _spotPriceAfter){
        require(_lock == false);
        uint256 _inRecordBal;
        uint256 _outRecordBal;
        uint256 _exitFee = _bmul(_tokenAmountIn, fee);
        uint256 _adjustedIn = _tokenAmountIn - _exitFee;
        if(_inIsCHD){
           _inRecordBal = recordBalanceSynth;
           _outRecordBal = recordBalance;
        } 
        else{
          _inRecordBal = recordBalance;
          _outRecordBal = recordBalanceSynth;
        }
        require(_tokenAmountIn <= _bmul(_inRecordBal, MAX_IN_RATIO));
        uint256 _spotPriceBefore = calcSpotPrice(
                                    _inRecordBal,
                                    _outRecordBal,
                                    0
                                );
        require(_spotPriceBefore <= _maxPrice);
        if(_inIsCHD){ //this is because we burn CHD on swaps (can't leave system w/o burning it)
          _tokenAmountOut = calcSingleOutGivenIn(
                  _outRecordBal,
                  _inRecordBal,
                  _adjustedIn,
                  0,
                  false
              );
        }
        else{
          _tokenAmountOut = calcOutGivenIn(
                            _inRecordBal,
                            _outRecordBal,
                            _adjustedIn,
                           0
                        );
        }
        require(_tokenAmountOut >= _minAmountOut);
        require(_spotPriceBefore <= _bdiv(_adjustedIn, _tokenAmountOut));
        _outRecordBal -= _tokenAmountOut;
        if(_inIsCHD){
           chd.burnCHD(msg.sender,_adjustedIn);
           require(token.transfer(msg.sender,_tokenAmountOut));
           recordBalance -= _tokenAmountOut;
           if(_exitFee > 0){
            chd.approve(address(controller),_exitFee);
            ICFC(controller).addFees(_exitFee,true);
           }
        } 
        else{
          _inRecordBal += _adjustedIn;
          require(token.transferFrom(msg.sender,address(this), _tokenAmountIn));
          chd.transfer(msg.sender,_tokenAmountOut);
          recordBalance += _adjustedIn;
          recordBalanceSynth -= _tokenAmountOut;
          if(fee > 0){
            token.approve(address(controller),_exitFee);
            ICFC(controller).addFees(_exitFee,false);
          }
        }
        _spotPriceAfter = calcSpotPrice(
                                _inRecordBal,
                                _outRecordBal,
                                0
                            );
        require(_spotPriceAfter >= _spotPriceBefore);     
        require(_spotPriceAfter <= _maxPrice);
        checkDrip();
        emit Swap(msg.sender,_inIsCHD,_tokenAmountIn,_tokenAmountOut);
      }

      /**
      * @dev allows users to send chd anonymously
      * @param _args proof data for sneding tokens
      * @param _extData external (visible data) to verify proof and pay relayer fee
      */
      function transact(Proof memory _args, ExtData memory _extData) external payable{
        require(_lock == false);
        _lock = true;
        int256 _publicAmount = _extData.extAmount - int256(_extData.fee);
        if(_publicAmount < 0){
          _publicAmount = int256(FIELD_SIZE - uint256(-_publicAmount));
        } 
        require(_args.publicAmount == uint256(_publicAmount));
        require(isKnownRoot(_args.root), "invalid root");
        require(_verifyProof(_args), "invalid proof");
        require(uint256(_args.extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "incorrect ed hash");
        if (_extData.extAmount < 0){
          chd.mintCHD(_extData.recipient, uint256(-_extData.extAmount));
        }
        _transact(_args, _extData, false);
        uint256 _outRebate;
        if(_extData.fee > 0){
          chd.mintCHD(msg.sender,_extData.fee);
          if(_extData.rebate > 0){
            _outRebate = calcOutGivenIn(recordBalanceSynth,recordBalance,_extData.rebate,0);
            require(_extData.fee > _extData.rebate, "rebate too big");
            //transfer base token from relayer to recipient
            //allows a user to get some funds to a blank addy
            payable(_extData.recipient).transfer(_outRebate);
          }
        }
        require(msg.value == _outRebate, "msg value != rebate");
        _lock = false;
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
     * @dev allows you to get the oracles for the contract
     */
    function getOracles() external view returns(address[] memory){
      return oracles;
    }

    /**
     * @dev returns the data for an oracle submission on another chain given a depositId
     */
    function getOracleSubmission(uint256 _depositId) public view returns(bytes memory){
      Commitment memory _p = depositCommitments[_depositId-1];
      return abi.encode(
        _p.proof.inputNullifiers[0],
        _p.proof.inputNullifiers[1],
        _p.proof.outputCommitments[0],
        _p.proof.outputCommitments[1],
        _p.proof.proof,
        _p.extData.encryptedOutput1,
        _p.extData.encryptedOutput2);
    }

    /**
     * @dev returns the partner contracts in this charon system and their chains
     */
    function getPartnerContracts() external view returns(PartnerContract[] memory){
      return partnerContracts;
    }

    /**
     * @dev allows you to check the spot price of the token pair
     * @return uint256 price of the pair
     */
    function getSpotPrice() external view returns(uint256){
      return calcSpotPrice(recordBalanceSynth,recordBalance, 0);
    }

    /**
     * @dev allows a user to see if their deposit has been withdrawn
     * @param _nullifierHash hash of nullifier identifying withdrawal
     */
    function isSpent(bytes32 _nullifierHash) external view returns (bool) {
      return nullifierHashes[_nullifierHash];
    }

    //internal
    /**
     * @dev override of _move function for pool token.  Prevents transfer of pool token for 1 day after singleSideCHD deposit
     * @param _src address of sender
     * @param _dst address of recipient
     * @param _amount amount of token to send
     */
    function _move(address _src, address _dst, uint256 _amount) internal override {
        require(block.timestamp > singleLockTime[_src]); //cannot move pool tokens if locked
        balance[_src] = balance[_src] - _amount;//will overflow if too big
        balance[_dst] = balance[_dst] + _amount;
        emit Transfer(_src, _dst, _amount);
    }

    /**
     * @dev internal logic of secret transfers and chd mints
     * @param _args proof data for sneding tokens
     * @param _extData external (visible data) to verify proof and pay relayer fee
     * @param _isDeposit bool if done during oracleDeposit
     */
    function _transact(Proof memory _args, ExtData memory _extData, bool _isDeposit) internal{
      for (uint256 _i = 0; _i < _args.inputNullifiers.length; _i++) {
        require(!nullifierHashes[_args.inputNullifiers[_i]], "Input already spent");
        nullifierHashes[_args.inputNullifiers[_i]] = true;
        emit NewNullifier(_args.inputNullifiers[_i]);
      }
      _insert(_args.outputCommitments[0], _args.outputCommitments[1]);
      checkDrip();
      emit NewCommitment(_args.outputCommitments[0], nextIndex - 2, _extData.encryptedOutput1, _isDeposit);
      emit NewCommitment(_args.outputCommitments[1], nextIndex - 1, _extData.encryptedOutput2, _isDeposit);
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
        revert("bad input count");
      }
  }
}
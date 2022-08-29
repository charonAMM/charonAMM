//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.4;

import "./CHD.sol";
import "./MerkleTreeWithHistory.sol";
import "./Token.sol";
import "./helpers/Math.sol";
import "./helpers/Oracle.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IVerifier.sol";
import "hardhat/console.sol";
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

    struct PartnerContract{
      uint256 chainID;
      address contractAddress;
    }

    struct ExtData {
      address recipient;
      uint256 extAmount;
      address relayer;
      uint256 fee;
    }

    struct Commitment{
      ExtData extData;
      Proof proof;
    }

    struct Proof {
      uint256[2] a;
      uint256[2][2] b;
      uint256[2] c;
      bytes32 root;
      uint256 extDataHash;
      uint256 publicAmount;
      bytes32[] inputNullifiers;
      bytes32[2] outputCommitments;
    }


    CHD public chd;
    IERC20 public token;//token deposited at this address
    IVerifier public verifier;
    PartnerContract[] partnerContracts;
    address public controller;//finalizes contracts, generates fees
    bool public finalized;
    bool private _mutex;//used for reentrancy protection
    Commitment[] public depositCommitments;//all commitments deposited by tellor in an array.  depositID is the position in array
    uint32 public merkleTreeHeight;
    uint256 public chainID; //chainID of this charon instance
    uint256 public fee;//fee when liquidity is withdrawn or trade happens
    uint256 public recordBalance;//balance of asset stored in this contract
    uint256 public recordBalanceSynth;//balance of asset bridged from other chain
    mapping(bytes32 => uint256) public depositIdByCommitmentHash;//gives you a deposit ID (used by tellor) given a commitment
    mapping(bytes32 => bool) public nullifierHashes;//zk proof hashes to tell whether someone withdrew

    //events
    event CharonFinalized(uint256[] _partnerChains,address[] _partnerAddys);
    event DepositToOtherChain(bool _isCHD, address _sender, uint256 _timestamp, uint256 _tokenAmount);
    event LPDeposit(address _lp,uint256 _poolAmountOut);
    event LPWithdrawal(address _lp, uint256 _poolAmountIn);
    event NewCommitment(bytes32 commitment, uint256 index);
    event NewNullifier(bytes32 nullifier);
    event LPWithdrawSingleCHD(address _lp,uint256 _tokenAmountOut);
    event ControllerChanged(address _newController);

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
                uint32 _merkleTreeHeight,
                uint256 _chainID,
                string memory _name,
                string memory _symbol
                )
              MerkleTreeWithHistory(_merkleTreeHeight, _hasher)
              Oracle(_oracle)
              Token(_name,_symbol){
        verifier = IVerifier(_verifier);
        token = IERC20(_token);
        fee = _fee;
        controller = msg.sender;
        chainID = _chainID;
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
        bytes32 _hashedCommitment = keccak256(abi.encode(_proofArgs.a,_proofArgs.b,_proofArgs.c,_proofArgs.publicAmount,_proofArgs.root));
        depositIdByCommitmentHash[_hashedCommitment] = _depositId;
        uint256 _tokenAmount;
        if (_isCHD){
          chd.burnCHD(msg.sender,_extData.extAmount);
        }
        else{
          _tokenAmount = calcInGivenOut(recordBalance,recordBalanceSynth,_extData.extAmount,0);
          require(token.transferFrom(msg.sender, address(this), _tokenAmount));
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
        uint256 _ratio = bdiv(_poolAmountOut, supply);
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
        uint256 _exitFee = bmul(_poolAmountIn, fee);
        uint256 _pAiAfterExitFee = bsub(_poolAmountIn, _exitFee);
        uint256 _ratio = bdiv(_pAiAfterExitFee, supply);
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
        bytes memory _iv;
        require(_chain.length == _depositId.length, "must be same length");
        for(uint256 _i; _i< _chain.length; _i++){
          _value = getCommitment(_chain[_i], _depositId[_i]);
          _iv = sliceBytes(_value,0,352);
          (_proof.a,_proof.b,_proof.c,_proof.publicAmount,_proof.root,_proof.extDataHash) = abi.decode(_iv,(uint256[2],uint256[2][2],uint256[2],uint256,bytes32,uint256));
          _iv= sliceBytes(_value,_value.length - 224,128);
          _extData = abi.decode(_iv,(ExtData));
          _iv = sliceBytes(_value,384,64);
          (_proof.outputCommitments[0],_proof.outputCommitments[1]) = abi.decode(_iv,(bytes32,bytes32));
          (bytes32 _a, bytes32 _b) = abi.decode(sliceBytes(_value,_value.length - 64,64),(bytes32,bytes32));
          _proof.inputNullifiers = new bytes32[](2);
          _proof.inputNullifiers[0] = _a;
          _proof.inputNullifiers[1] = _b;
          _transact(_proof, _extData);
        }
    }


function sliceBytes(bytes memory _bytes,uint256 _start,uint256 _length)internal pure returns (bytes memory tempBytes){
        require(_length + 31 >= _length, "slice_overflow");
        require(_bytes.length >= _start + _length, "slice_outOfBounds");
        assembly {
            switch iszero(_length)
            case 0 {
                tempBytes := mload(0x40)
                let lengthmod := and(_length, 31)
                let mc := add(add(tempBytes, lengthmod), mul(0x20, iszero(lengthmod)))
                let end := add(mc, _length)
                for {
                    let cc := add(add(add(_bytes, lengthmod), mul(0x20, iszero(lengthmod))), _start)
                } lt(mc, end) {
                    mc := add(mc, 0x20)
                    cc := add(cc, 0x20)
                } {
                    mstore(mc, mload(cc))
                }
                mstore(tempBytes, _length)
                mstore(0x40, and(add(mc, 31), not(31)))
            }
            //if we want a zero-length slice let's just return a zero-length array
            default {
                tempBytes := mload(0x40)
                mstore(tempBytes, 0)
                mstore(0x40, add(tempBytes, 0x20))
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

  //lets you do secret transfers / withdraw + mintCHD
  function transact(Proof memory _args, ExtData memory _extData,address _to) external _finalized_ _lock_{
      require(_extData.extAmount > 0,"must move amount");
      require(_args.publicAmount == _extData.extAmount -  _extData.fee, "Invalid public amount");
      require(isKnownRoot(_args.root), "Invalid merkle root");
      require(verifier.verifyProof(_args.a,
                _args.b,
                _args.c,
          [
            chainID,
            uint256(_args.root),
            _args.publicAmount,
            _args.extDataHash,
            uint256(_args.inputNullifiers[0]),
            uint256(_args.inputNullifiers[1]),
            uint256(_args.outputCommitments[0]),
            uint256(_args.outputCommitments[1])
          ]), "Invalid transaction proof");
      if(_extData.recipient == address(this)){
        require(chd.mintCHD(_to,uint256(_extData.extAmount - _extData.fee)));
      }
      if(_extData.fee > 0){
        require(token.transfer(_extData.relayer,_extData.fee));
      }
      _transact(_args, _extData);
  }

  function _transact(Proof memory _args, ExtData memory _extData) internal _finalized_ _lock_ {
    for (uint256 _i = 0; _i < _args.inputNullifiers.length; _i++) {
      require(!nullifierHashes[_args.inputNullifiers[_i]], "Input is already spent");
      nullifierHashes[_args.inputNullifiers[_i]] = true;
      emit NewNullifier(_args.inputNullifiers[_i]);
    }
    require(uint256(_args.extDataHash) == uint256(keccak256(abi.encode(_extData))) % FIELD_SIZE, "Incorrect external data hash");
    _insert(_args.outputCommitments[0], _args.outputCommitments[1]);
    emit NewCommitment(_args.outputCommitments[0], nextIndex - 2);
    emit NewCommitment(_args.outputCommitments[1], nextIndex - 1);
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

    /**
     * @dev allows a user to see if their deposit has been withdrawn
     * @param _nullifierHash hash of nullifier identifying withdrawal
     */
    function isSpent(bytes32 _nullifierHash) external view returns (bool) {
      return nullifierHashes[_nullifierHash];
    }

    /**
     * @dev allows you to see whether an array of notes has been spent
     * @param _nullifierHashes array of notes identifying withdrawals
     */
    function isSpentArray(bytes32[] calldata _nullifierHashes) external view returns (bool[] memory _spent) {
      _spent = new bool[](_nullifierHashes.length);
      for (uint256 _i = 0; _i < _nullifierHashes.length; _i++) {
        if (nullifierHashes[_nullifierHashes[_i]]){
          _spent[_i] = true;
        }
      }
    }
}
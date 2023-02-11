const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect, assert } = require('chai')
const { utils } = ethers
const web3 = require('web3');
const abiCoder = new ethers.utils.AbiCoder()
const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")
const HASH = require("../build/Hasher.json")
const h = require("usingtellor/test/helpers/helpers.js");
const { buildPoseidon } = require("circomlibjs");

let ABI = ["function getOracleSubmission(uint256 _depositId)"];
let iface = new ethers.utils.Interface(ABI);

async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }
describe("charon tests", function () {
    let accounts;
    let verifier2,verifier16,token,charon,hasher,token2,charon2, mockNative ,mockNative2, cfc,cfc2, gnosisAMB, gnosisAMB2, e2p, p2e;
    let fee = 0;
    let HEIGHT = 5;
    let builtPoseidon;
    let requestSelector = "0x88b6c755140efe88bff94bfafa4a7fdffe226d27d92bd45385bb0cfa90986650";
    beforeEach(async function () {
        builtPoseidon = await buildPoseidon()
        accounts = await ethers.getSigners();
        verifier2 = await deploy('Verifier2')
        verifier16 = await deploy('Verifier16')
        let Hasher = await ethers.getContractFactory(HASH.abi, HASH.bytecode);
        hasher = await Hasher.deploy();
        await hasher.deployed()
        token = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey","DSM")
        await token.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        //deploy tellor
        let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor = await TellorOracle.deploy();
        tellor2 = await TellorOracle.deploy();
        await tellor2.deployed();
        await tellor.deployed();
        mockNative = await deploy("MockNativeBridge")
        mockNative2 = await deploy("MockNativeBridge")
        gnosisAMB = await deploy("GnosisAMB", mockNative.address, tellor.address)
        gnosisAMB2 = await deploy("GnosisAMB", mockNative2.address, tellor2.address)
        p2e = await deploy("MockPOLtoETHBridge", tellor2.address, mockNative2.address)
        e2p = await deploy("MockETHtoPOLBridge", tellor.address,mockNative.address, mockNative.address,mockNative.address)
        await mockNative.setUsers(gnosisAMB.address, p2e.address, e2p.address)
        await mockNative2.setUsers(gnosisAMB2.address, p2e.address, e2p.address)
        charon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token.address,fee,[gnosisAMB.address],HEIGHT,1,"Charon Pool Token","CPT")
        //now deploy on other chain (same chain, but we pretend w/ oracles)
        token2 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        charon2 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,[gnosisAMB2.address],HEIGHT,2,"Charon Pool Token2","CPT2");
        chd = await deploy("MockERC20",charon.address,"charon dollar","chd")
        chd2 = await deploy("MockERC20",charon2.address,"charon dollar2","chd2")
        //now set both of them. 
        await token.approve(charon.address,web3.utils.toWei("100"))//100
        await token2.approve(charon2.address,web3.utils.toWei("100"))//100
        cfc = await deploy('MockCFC',token.address,chd.address)
        cfc2 = await deploy('MockCFC',token2.address,chd2.address)
        await charon.finalize([2],[charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address,cfc.address);
        await charon2.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd2.address, cfc2.address);
    });

    function poseidon(inputs){
      let val = builtPoseidon(inputs)
      return builtPoseidon.F.toString(val)
    }

    function poseidon2(a,b){
      return poseidon([a,b])
    }
    it("generates same poseidon hash", async function () {
        const res = await hasher["poseidon(bytes32[2])"]([toFixedHex(1,32), toFixedHex(1,32)]);
        const res2 = await poseidonHash([toFixedHex(1,32), toFixedHex(1,32)]);
        assert(res - res2 == 0, "should be the same hash");
    }).timeout(500000);
    it("Test Constructor", async function() {
        let _o = await charon.getOracles();
        assert(_o[0] == gnosisAMB.address, "oracle  address should be set")
        assert(await charon.levels() == HEIGHT, "merkle Tree height should be set")
        assert(await charon.hasher() == hasher.address, "hasher should be set")
        assert(await charon.verifier2() == verifier2.address, "verifier2 should be set")
        assert(await charon.verifier16() == verifier16.address, "verifier16 should be set")
        assert(await charon.token() == token.address, "token should be set")
        assert(await charon.fee() == fee, "fee should be set")
        assert(await charon.controller() == cfc.address, "controller should be set")
        assert(await charon.chainID() == 1, "chainID should be correct")
      });
      it("Test addRewards()", async function() {
        await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
        await h.expectThrow(charon.connect(accounts[1]).addRewards(web3.utils.toWei("50"),web3.utils.toWei("50"),web3.utils.toWei("50"),true))
        await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("150"))
        await charon.connect(accounts[1]).addRewards(web3.utils.toWei("50"),web3.utils.toWei("50"),web3.utils.toWei("50"),true);
        assert(await charon.userRewardsCHD() == web3.utils.toWei("50"))
        await token.mint(accounts[1].address,web3.utils.toWei("1000"))
        await h.expectThrow(charon.connect(accounts[1]).addRewards(web3.utils.toWei("50"),web3.utils.toWei("50"),web3.utils.toWei("50"),false))
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("150"))
        await charon.connect(accounts[1]).addRewards(web3.utils.toWei("50"),web3.utils.toWei("50"),web3.utils.toWei("50"),false);
        assert(await charon.userRewards() == web3.utils.toWei("50"))
        assert(await charon.recordBalanceSynth() == web3.utils.toWei("1050"))
        assert(await charon.recordBalance() == web3.utils.toWei("150"))
        assert(await charon.oracleCHDFunds() == web3.utils.toWei("50"))
        assert(await charon.oracleTokenFunds() == web3.utils.toWei("50"))
      });
      it("Test depositToOtherChain", async function() {
        let _depositAmount = web3.utils.toWei("10");
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                  web3.utils.toWei("1000"),
                                                  _depositAmount,
                                                  0)
        
        const sender = accounts[0]
        const aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon , chainID: 2})
        charon = charon.connect(sender)
        let inputData = await prepareTransaction({
          charon,
          inputs:[],
          outputs: [aliceDepositUtxo],
          account: {
            owner: sender.address,
            publicKey: aliceDepositUtxo.keypair.address(),
          },
          privateChainID: 2,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
        })
        let args = inputData.args
        let extData = inputData.extData
        await h.expectThrow(charon.connect(accounts[1]).depositToOtherChain(args,extData,false))
        await h.expectThrow(charon.connect(accounts[1]).depositToOtherChain(args,extData,true))
        await token.connect(accounts[1]).approve(charon.address,_amount)
        await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
        let commi = await charon.getDepositCommitmentsById(1);
        assert(commi[1].proof == args.proof, "commitment a should be stored")
        assert(commi[1].publicAmount - args.publicAmount == 0, "commitment publicAmount should be stored")
        assert(commi[1].root == args.root, "commitment root should be stored")
        assert(commi[1].inputNullifiers[0] == args.inputNullifiers[0], "commitment inputNullifiers should be stored")
        assert(commi[1].inputNullifiers[1] == args.inputNullifiers[1], "commitment inputNullifiers should be stored")
        assert(commi[1].outputCommitments[0] == args.outputCommitments[0], "commitment outputCommitments should be stored")
        assert(commi[1].outputCommitments[1] == args.outputCommitments[1], "commitment outputCommitments should be stored")
        assert(commi[1].extDataHash - args.extDataHash == 0, "commitment extDataHash should be stored")
        assert(commi[0].recipient == extData.recipient, "extData should be correct");
        assert(commi[0].extAmount - extData.extAmount == 0, "extDataAmount should be correct");
        assert(commi[0].relayer == extData.relayer, "extData should be correct");
        assert(commi[0].fee - extData.fee == 0, "extData fee should be correct");
        const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
          ['bytes','uint256','bytes32'],
          [args.proof,args.publicAmount,args.root]
        );
        assert(await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded)) == 1, "reverse commitment mapping should work")
        assert(await charon.recordBalance() * 1 -(1* web3.utils.toWei("100") + 1 * _amount) == 0, "recordBalance should go up")
        assert(await token.balanceOf(accounts[1].address) == web3.utils.toWei("100") - _amount, "balance should change properly")
      });
      it("Test finalize", async function() {
        let testCharon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,[tellor2.address],HEIGHT,2,"Charon Pool Token2","CPT2");
        let chd3 = await deploy("MockERC20",testCharon.address,"charon dollar3","chd3")
        await h.expectThrow(testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address,cfc.address));//must transfer token
        await token2.approve(testCharon.address,web3.utils.toWei("100"))//100
        await h.expectThrow(testCharon.connect(accounts[1]).finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address,cfc.address))//must be controller
        await h.expectThrow(testCharon.finalize([1,2],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address,cfc.address))//length should be same
        await testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address,cfc.address);
        await h.expectThrow(testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address,cfc.address))//already finalized
        assert(await testCharon.finalized(), "should be finalized")
        assert(await testCharon.balanceOf(accounts[0].address) - web3.utils.toWei("100") == 0, "should have full balance")
        assert(await testCharon.recordBalance() == web3.utils.toWei("100"), "record Balance should be set")
        assert(await testCharon.recordBalanceSynth() == web3.utils.toWei("1000"), "record Balance synth should be set")
        assert(await testCharon.chd() == chd3.address, "chd should be set")
        let pC = await testCharon.getPartnerContracts();
        assert(pC[0][0] == 1, "partner chain should be correct")
        assert(pC[0][1] == charon.address, "partner address should be correct")
        assert(await testCharon.controller() == cfc.address, "controller should be cfc")
      });
    it("Test lpDeposit", async function() {
      await h.expectThrow(charon.lpDeposit(2,0,0));//cannot put zero in
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
      await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
      let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
          web3.utils.toWei("100"),//poolSupply
          web3.utils.toWei("10")//tokenamountIn
          )
      await h.expectThrow(charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("50"),web3.utils.toWei("5")))
      await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      assert(minOut >= web3.utils.toWei("4.88"), "should be greater than this")
      await charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
      assert(await charon.recordBalance() - web3.utils.toWei("104.88") > 0, "record balance should be correct")
      assert(await charon.recordBalance() - web3.utils.toWei("104.88") < web3.utils.toWei("1"), "record balance should be correct")
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1048.8")> 0, "record balance synth should be correct")
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1048.8")< web3.utils.toWei("1"), "record balance synth should be correct")
      assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei("4.88") > 0 , "mint of tokens should be correct")
      assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei("4.88") < web3.utils.toWei(".01") , "mint of tokens should be correct")
      assert(await token.balanceOf(accounts[1].address)*1 +  web3.utils.toWei("4.88") -  web3.utils.toWei("100") > 0, "contract should take tokens")
      assert(await chd.balanceOf(accounts[1].address)*1 + web3.utils.toWei("48.8") - web3.utils.toWei("1000") > 0, "contractsynth should take tokens")
      let tbal = await token.balanceOf(accounts[1].address)
      assert((tbal*1) +  1* web3.utils.toWei("4.88") -  1* web3.utils.toWei("100") < 1* web3.utils.toWei("0.1"), "contract should take tokens")
      assert(await chd.balanceOf(accounts[1].address)*1 + 1* web3.utils.toWei("48.8") - 1* web3.utils.toWei("1000") < web3.utils.toWei("0.1"), "contractsynth should take tokens")
    });
    it("Test lpSingleCHD", async function() {
      await h.expectThrow(charon.lpSingleCHD(0,1));//cannot put zero in
      await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
      let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("1000"),//tokenBalanceIn
          web3.utils.toWei("100"),//poolSupply
          web3.utils.toWei("10")//tokenamountIn
          )
      await h.expectThrow(charon.connect(accounts[1]).lpSingleCHD(web3.utils.toWei("10"),minOut))
      await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      assert(minOut - web3.utils.toWei(".498") > 0, "should be greater than this")
      await charon.connect(accounts[1]).lpSingleCHD(web3.utils.toWei("10"),minOut)
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1010") == 0, "record balancesynth should be correct")
      assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei(".4987") > 0 , "mint of tokens should be correct")
      assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei(".4987") < web3.utils.toWei(".01") , "mint of tokens should be correct")
      assert(await chd.balanceOf(accounts[1].address)*1 - web3.utils.toWei("990") == 0, "contractsynth should take tokens")
    });
    it("Test lpWithdraw", async function() {
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
        await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
        await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
        let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
                                              web3.utils.toWei("100"),//poolSupply
                                              web3.utils.toWei("10")//tokenamountIn
                                              )
        await charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
        let poolSupply = await charon.totalSupply()
        await h.expectThrow(charon.connect(accounts[1]).lpWithdraw(1, web3.utils.toWei("48.8"),web3.utils.toWei("4.88")) )
        await h.expectThrow(charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei("4.88"), web3.utils.toWei("500"),web3.utils.toWei("4.88")) )
        await h.expectThrow(charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei("4.88"), web3.utils.toWei("48.8"),web3.utils.toWei("500")) )
        await charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei("4.88"), web3.utils.toWei("48.8"),web3.utils.toWei("4.88"))
        assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("99") > 0, "record balance should be back to correct" )
        assert((await charon.recordBalanceSynth()*1) - 1*web3.utils.toWei("999") > 0, "record balance should be back to correct" )
        assert((await charon.recordBalanceSynth()*1) - 1*web3.utils.toWei("999.9") < 1*web3.utils.toWei("1"), "record balance should be back to correct" )
        assert(await charon.balanceOf(accounts[1].address)*1 < web3.utils.toWei("0.01"), "all pool tokens should be gone")
        assert(await token.balanceOf(accounts[1].address)*1 - web3.utils.toWei("99") > 0, "token balance should be back to correct" )
        assert(await chd.balanceOf(accounts[1].address)*1 - web3.utils.toWei("999") > 0, "token balance should be back to correct" )
        assert(web3.utils.toWei("101") - await token.balanceOf(accounts[1].address)*1 > 0, "token balance should be back to correct" )
    });
    it("Test lpWithdrawSingleCHD", async function() {
        await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
        let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("1000"),//tokenBalanceIn
            web3.utils.toWei("100"),//poolSupply
            web3.utils.toWei("10")//tokenamountIn
            )
        await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
        await charon.connect(accounts[1]).lpSingleCHD(web3.utils.toWei("10"),minOut)
        let poolSupply = await charon.totalSupply()
        await h.expectThrow(charon.connect(accounts[1]).lpWithdrawSingleCHD(1, web3.utils.toWei("9.9")))
        await h.expectThrow(charon.connect(accounts[1]).lpWithdrawSingleCHD(web3.utils.toWei(".4987"), web3.utils.toWei("100")))
        await charon.connect(accounts[1]).lpWithdrawSingleCHD(web3.utils.toWei(".4987"), web3.utils.toWei("9.9"))
        let ps = web3.utils.toWei("100") + await charon.recordBalance()*1
        minOut = await charon.calcSingleOutGivenIn(web3.utils.toWei("1010"),ps,web3.utils.toWei(".4987"),0,true)
        assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("100") == 0, "record balance should not move" )
        assert((await charon.recordBalanceSynth()*1) - 1*web3.utils.toWei("1000") > 0 , "record balance synth should be back to correct" )
        assert((await charon.recordBalanceSynth()*1) - 1*web3.utils.toWei("1000") < web3.utils.toWei(".1") , "record balance synth should be back to correct" )
        assert(await charon.balanceOf(accounts[1].address)*1 < web3.utils.toWei("0.01"), "all pool tokens should be gone")
        assert(await token.balanceOf(accounts[1].address)*1 == 0, "token balance should not move" )
        assert(await chd.balanceOf(accounts[1].address)*1 - web3.utils.toWei("999") > 0, "token balance should be back to correct" )
        assert(web3.utils.toWei("101") - await token.balanceOf(accounts[1].address)*1 > 0, "token balance should be back to correct" )
    });
    it("Test oracleDeposit", async function() {
        let _depositAmount = web3.utils.toWei("10");
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                  web3.utils.toWei("1000"),
                                                  _depositAmount,
                                                  0)
        await token.connect(accounts[1]).approve(charon.address,_amount)
        const sender = accounts[0]
        const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc:poseidon, chainID: 2 })
        charon = charon.connect(sender)
        let inputData = await prepareTransaction({
          charon,
          inputs:[],
          outputs: [aliceDepositUtxo],
          account: {
            owner: sender.address,
            publicKey: aliceDepositUtxo.keypair.address(),
          },
          privateChainID: 2,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
        })
        let args = inputData.args
        let extData = inputData.extData
        await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
        const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
        ['bytes','uint256','bytes32'],
        [args.proof,args.publicAmount,args.root]
        );
        let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
        let commi = await getTellorSubmission(args,extData);
        await mockNative2.setAMBInfo(depositId, commi)
        _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
        await charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
        await h.expectThrow(charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'})))
        assert(await charon2.isSpent(args.inputNullifiers[0]) == true ,"nullifierHash should be true")
        assert(await charon2.isSpent(args.inputNullifiers[1]) == true ,"nullifierHash should be true")
        });
        it("swap", async function () {
          await token.mint(accounts[1].address,web3.utils.toWei("100"))
          let _minOut = await charon.calcOutGivenIn(web3.utils.toWei("100"),web3.utils.toWei("1000"),web3.utils.toWei("10"),0)
          let _maxPrice = await charon.calcSpotPrice(web3.utils.toWei("110"),web3.utils.toWei("900"),0)
          await h.expectThrow(charon.swap(false,web3.utils.toWei("10"), _minOut,_maxPrice))//transfer not approved
          await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
          await h.expectThrow(charon.swap(false,web3.utils.toWei("10"), _minOut,1))//bad max price
          await h.expectThrow(charon.swap(false,web3.utils.toWei("1"), _minOut,_maxPrice))//too little in
          await h.expectThrow(charon.swap(false,web3.utils.toWei("10"),web3.utils.toWei("50000"),_maxPrice))//too much out
          await charon.connect(accounts[1]).swap(false,web3.utils.toWei("10"), _minOut,_maxPrice)
          assert(await charon.recordBalance() == web3.utils.toWei("110"), "record Balance should be correct")
          assert(await charon.recordBalanceSynth() > web3.utils.toWei("900"), "recordBalanceSynth should be correct")
          assert(await charon.recordBalanceSynth() < web3.utils.toWei("910"), "recordBalanceSynth should be correct")
          assert(await chd.balanceOf(accounts[1].address) - _minOut == 0, "chd should transfer")
          assert(await charon.getSpotPrice() - web3.utils.toWei("8.2") > 0,"swap price should be correct")
          assert(await charon.getSpotPrice() - web3.utils.toWei("8.2") < web3.utils.toWei("0.1"),"swap price should be correct2")
        });
        it("deposit and transact", async function () {
            let _depositAmount = utils.parseEther('10');
            await token.mint(accounts[1].address,web3.utils.toWei("100"))
            let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                      web3.utils.toWei("1000"),
                                                      _depositAmount,
                                                      0)
            
            await token.connect(accounts[1]).approve(charon.address,_amount)
            const sender = accounts[0]
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc: poseidon, chainID: 2 })
            charon = charon.connect(sender)
            let inputData = await prepareTransaction({
              charon,
              inputs:[],
              outputs: [aliceDepositUtxo],
              account: {
                owner: sender.address,
                publicKey: aliceDepositUtxo.keypair.address(),
              },
              privateChainID: 2,
              myHasherFunc: poseidon,
              myHasherFunc2: poseidon2
            })
            let args = inputData.args
            let extData = inputData.extData
            await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
            const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
            ['bytes','uint256','bytes32'],
            [args.proof,args.publicAmount,args.root]
            );
            let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
            let commi = await getTellorSubmission(args,extData);
            await mockNative2.setAMBInfo(depositId, commi)
            _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
            await charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
            // Alice sends some funds to withdraw (ignore bob)
            let bobSendAmount = utils.parseEther('4')
            const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
 // contains private and public keys
            const bobAddress = await bobKeypair.address() // contains only public key
            const bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(bobAddress,poseidon), chainID: 2 })
            let aliceChangeUtxo = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                myHashFunc: poseidon,
                keypair: aliceDepositUtxo.keypair,
                chainID: 2
            })
            inputData = await prepareTransaction({
                charon: charon2,
                inputs:[aliceDepositUtxo],
                outputs: [bobSendUtxo, aliceChangeUtxo],
                privateChainID: 2,
                myHasherFunc: poseidon,
                myHasherFunc2: poseidon2
              })
            args = inputData.args
            extData = inputData.extData
            let badArg1,badExtData,badArg2,badExtData2
            badArg1 = Object.assign({},args);
            badArg1.root = h.hash("badroot")
            badExtData = Object.assign({},extData)
            badExtData.extAmount = '0x00000000055000000000000000000000000000000000000000000000000000000'
            badArg2 = Object.assign({},args);
            badArg2.proof = h.hash("badproof")
            badExtData2 = Object.assign({},extData)
            badExtData2.recipient = accounts[2].address
            await h.expectThrow(charon2.transact(badArg1,extData))//bad root
            await h.expectThrow(charon2.transact(badArg2,extData))//bad proof
            await h.expectThrow(charon2.transact(args,badExtData))//bad public amount
            await h.expectThrow(charon2.transact(args,badExtData2))// bad extData hash (changed recipient)
            assert(await charon2.isKnownRoot(inputData.args.root));
            await charon2.transact(args,extData)
                // Bob parses chain to detect incoming funds
            const filter = charon2.filters.NewCommitment()
            const fromBlock = await ethers.provider.getBlock()
            const events = await charon2.queryFilter(filter, fromBlock.number)
            let bobReceiveUtxo
            try {
                bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args._encryptedOutput, events[0].args._index)
            } catch (e) {
            // we try to decrypt another output here because it shuffles outputs before sending to blockchain
                bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args._encryptedOutput, events[1].args._index)
            }
            expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount)
        })
        it("deposit and withdraw", async function () {
            let _depositAmount = utils.parseEther('10');
            await token.mint(accounts[1].address,web3.utils.toWei("100"))
            let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                      web3.utils.toWei("1000"),
                                                      _depositAmount,
                                                      0)
            await token.connect(accounts[1]).approve(charon.address,_amount)
            const sender = accounts[0]
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 2 })
            charon = charon.connect(sender)
            let inputData = await prepareTransaction({
              charon,
              inputs:[],
              outputs: [aliceDepositUtxo],
              account: {
                owner: sender.address,
                publicKey: aliceDepositUtxo.keypair.address(),
              },
              privateChainID: 2,
              myHasherFunc: poseidon,
              myHasherFunc2: poseidon2
            })
            let args = inputData.args
            let extData = inputData.extData
            await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
            const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
            ['bytes','uint256','bytes32'],
            [args.proof,args.publicAmount,args.root]
            );
            let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
            let commi = await getTellorSubmission(args,extData);
            await mockNative2.setAMBInfo(depositId, commi)
            _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
            await charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
            //alice withdraws
            inputData = await prepareTransaction({
                charon: charon2,
                inputs: [aliceDepositUtxo],
                outputs: [],
                recipient: accounts[1].address,
                privateChainID: 2,
                myHasherFunc: poseidon,
                myHasherFunc2: poseidon2
            })
            await charon2.transact(inputData.args,inputData.extData)
            assert(await chd2.balanceOf(accounts[1].address) - _depositAmount == 0, "should mint CHD");
        })
        it("gas costs by function", async function () {
          let _depositAmount = utils.parseEther('10');
            await token.mint(accounts[1].address,web3.utils.toWei("100"))
            let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                      web3.utils.toWei("1000"),
                                                      _depositAmount,
                                                      0)
            
            await token.connect(accounts[1]).approve(charon.address,_amount)
            const sender = accounts[0]
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc: poseidon, chainID: 2 })
            charon = charon.connect(sender)
            let inputData = await prepareTransaction({
              charon,
              inputs:[],
              outputs: [aliceDepositUtxo],
              account: {
                owner: sender.address,
                publicKey: aliceDepositUtxo.keypair.address(),
              },
              privateChainID: 2,
              myHasherFunc: poseidon,
              myHasherFunc2: poseidon2
            })
            let args = inputData.args
            let extData = inputData.extData
            let gas = await charon.connect(accounts[1]).estimateGas.depositToOtherChain(args,extData,false);
            console.log('depositToOtherChain', gas - 0)
            await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
            const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
            ['bytes','uint256','bytes32'],
            [args.proof,args.publicAmount,args.root]
            );
            let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded)) 
            let commi = await getTellorSubmission(args,extData);
            await mockNative2.setAMBInfo(depositId, commi)
            _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
            gas =  await charon2.estimateGas.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
            console.log('oracleDeposit', gas - 0)
            await charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
            // Alice sends some funds to withdraw (ignore bob)
            let bobSendAmount = utils.parseEther('4')
            const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
 // contains private and public keys
            const bobAddress = await bobKeypair.address() // contains only public key
            const bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair, chainID: 2 })
            let aliceChangeUtxo = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                myHashFunc: poseidon,
                keypair: aliceDepositUtxo.keypair,
                chainID: 2
            })
            inputData = await prepareTransaction({
                charon: charon2,
                inputs:[aliceDepositUtxo],
                outputs: [bobSendUtxo, aliceChangeUtxo],
                privateChainID: 2,
                myHasherFunc: poseidon,
                myHasherFunc2: poseidon2
              })
            args = inputData.args
            extData = inputData.extData
            gas = await charon2.estimateGas.transact(args,extData)
            console.log('transact (2)', gas- 0)
            await charon2.transact(args,extData)
            //add transact16
            const bobSendUtxo2 = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair , chainID: 2})
            let aliceChangeUtxo2 = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                myHashFunc: poseidon,
                keypair: aliceChangeUtxo.keypair,
                chainID: 2
            })
            inputData = await prepareTransaction({
                charon: charon2,
                inputs:[aliceChangeUtxo],
                outputs: [bobSendUtxo2, aliceChangeUtxo2],
                privateChainID: 2,
                myHasherFunc: poseidon,
                myHasherFunc2: poseidon2
              })
            args = inputData.args
            extData = inputData.extData
            await charon2.transact(args,extData)

            //second w/ more
            let charlieSendAmount = utils.parseEther('7')
            const charlieKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
            // contains private and public keys
                       const charlieAddress = await charlieKeypair.address() // contains only public key
                       const charlieSendUtxo = new Utxo({ amount: charlieSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(charlieAddress,poseidon),chainID: 2 })
                       let bobChangeUtxo = new Utxo({
                           amount: utils.parseEther('1'),
                           myHashFunc: poseidon,
                           keypair: bobSendUtxo.keypair,
                           chainID: 2
                       })
                       inputData = await prepareTransaction({
                           charon: charon2,
                           inputs:[bobSendUtxo, bobSendUtxo2],
                           outputs: [bobChangeUtxo,charlieSendUtxo],
                           privateChainID: 2,
                           myHasherFunc: poseidon,
                           myHasherFunc2: poseidon2
                         })
                       args = inputData.args
                       extData = inputData.extData
                       gas = await charon2.estimateGas.transact(args,extData)
                       console.log('transact (16)', gas- 0)
                       await charon2.transact(args,extData)
        })
        it("Test getDepositCommitmentsById()", async function() {
          let _depositAmount = web3.utils.toWei("10");
          await token.mint(accounts[4].address,web3.utils.toWei("100"))
          let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                    web3.utils.toWei("1000"),
                                                    _depositAmount,
                                                    0)
          
          const sender = accounts[4]
          const aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon , chainID: 2})
          charon = charon.connect(sender)
          let inputData = await prepareTransaction({
            charon,
            inputs:[],
            outputs: [aliceDepositUtxo],
            account: {
              owner: sender.address,
              publicKey: aliceDepositUtxo.keypair.address(),
            },
            privateChainID: 2,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
          let args = inputData.args
          let extData = inputData.extData
          await h.expectThrow(charon.connect(accounts[1]).depositToOtherChain(args,extData,false))
          await h.expectThrow(charon.connect(accounts[1]).depositToOtherChain(args,extData,true))
          await token.connect(accounts[4]).approve(charon.address,_amount)
          await charon.connect(accounts[4]).depositToOtherChain(args,extData,false);
          let commi = await charon.getDepositCommitmentsById(1);
          assert(commi[1].proof == args.proof, "commitment a should be stored")
          assert(commi[1].publicAmount - args.publicAmount == 0, "commitment publicAmount should be stored")
          assert(commi[1].root == args.root, "commitment root should be stored")
          assert(commi[1].inputNullifiers[0] == args.inputNullifiers[0], "commitment inputNullifiers should be stored")
          assert(commi[1].inputNullifiers[1] == args.inputNullifiers[1], "commitment inputNullifiers should be stored")
          assert(commi[1].outputCommitments[0] == args.outputCommitments[0], "commitment outputCommitments should be stored")
          assert(commi[1].outputCommitments[1] == args.outputCommitments[1], "commitment outputCommitments should be stored")
          assert(commi[1].extDataHash - args.extDataHash == 0, "commitment extDataHash should be stored")
          assert(commi[0].recipient == extData.recipient, "extData should be correct");
          assert(commi[0].extAmount - extData.extAmount == 0, "extDataAmount should be correct");
          assert(commi[0].relayer == extData.relayer, "extData should be correct");
          assert(commi[0].fee - extData.fee == 0, "extData fee should be correct");
        });
        it("Test getDepositIdByCommitmentHash()", async function() {
          const sender = accounts[0]
          let _depositAmount = web3.utils.toWei("10");
          await token.mint(accounts[1].address,web3.utils.toWei("100"))
          let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                    web3.utils.toWei("1000"),
                                                    _depositAmount,
                                                    0)
          let aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 2 })
          charon = charon.connect(sender)
          let inputData = await prepareTransaction({
            charon,
            inputs:[],
            outputs: [aliceDepositUtxo],
            account: {
              owner: sender.address,
              publicKey: aliceDepositUtxo.keypair.address(),
            },
            privateChainID: 2,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
          let args = inputData.args
          let extData = inputData.extData
          await token.connect(accounts[1]).approve(charon.address,_amount)
          await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
          let dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
            ['bytes','uint256','bytes32'],
            [args.proof,args.publicAmount,args.root]
          );
          assert(await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded)) == 1, "reverse commitment mapping should work")
          _amount = await charon.calcInGivenOut(web3.utils.toWei("100") + _amount,
                web3.utils.toWei("1000"),
                _depositAmount,
                0)
          aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 2 })
          inputData = await prepareTransaction({
            charon,
            inputs:[],
            outputs: [aliceDepositUtxo],
            account: {
              owner: sender.address,
              publicKey: aliceDepositUtxo.keypair.address(),
            },
            privateChainID: 2,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
          args = inputData.args
          extData = inputData.extData
          await token.connect(accounts[1]).approve(charon.address,_amount)
          await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
          dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
            ['bytes','uint256','bytes32'],
            [args.proof,args.publicAmount,args.root]
          );
          assert(await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded)) == 2, "reverse commitment mapping should work")
        })
        it("getOracleSubmission",async function() {
          const sender = accounts[0]
          let _depositAmount = web3.utils.toWei("10");
          await token.mint(accounts[1].address,web3.utils.toWei("100"))
          let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                    web3.utils.toWei("1000"),
                                                    _depositAmount,
                                                    0)
          let aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 2 })
          charon = charon.connect(sender)
          let inputData = await prepareTransaction({
            charon,
            inputs:[],
            outputs: [aliceDepositUtxo],
            account: {
              owner: sender.address,
              publicKey: aliceDepositUtxo.keypair.address(),
            },
            privateChainID: 2,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
          let args = inputData.args
          let extData = inputData.extData
          await token.connect(accounts[1]).approve(charon.address,_amount)
          await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
          let dataEncoded = await getTellorSubmission(args,extData)
          let subData = await charon.getOracleSubmission(1)
          assert(subData == dataEncoded, "oracle getter should work")
        })
        it("Test getPartnerContracts()", async function() {
          let pC = await charon.getPartnerContracts();
          assert(pC[0][0] == 2, "partner chain should be correct")
          assert(pC[0][1] == charon2.address, "partner address should be correct")
        })
        it("Test getTokens()", async function() {
          let toks = await charon.getTokens()
          assert(toks[0] == chd.address, "chd should be slot 0")
          assert(toks[1] == token.address, "token should be slot 1")
        });
        it("Test getSpotPrice()", async function() {
          let sprice = await charon.getSpotPrice();
          assert(sprice == web3.utils.toWei("10"), "chd spot price should be correct 10eth per chd")
          //lp some more
          await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
          let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("1000"),//tokenBalanceIn
              web3.utils.toWei("100"),//poolSupply
              web3.utils.toWei("100")//tokenamountIn
              )
          await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
          await charon.connect(accounts[1]).lpSingleCHD(web3.utils.toWei("100"),minOut)
          //check spot price again
          sprice = await charon.getSpotPrice();
          assert(sprice == web3.utils.toWei("11"), "chd should be slot 0")
        });
        it("Test isSpent()", async function() {
          let _depositAmount = utils.parseEther('10');
            await token.mint(accounts[1].address,web3.utils.toWei("100"))
            let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                      web3.utils.toWei("1000"),
                                                      _depositAmount,
                                                      0)
            
            await token.connect(accounts[1]).approve(charon.address,_amount)
            const sender = accounts[0]
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc: poseidon, chainID: 2 })
            charon = charon.connect(sender)
            let inputData = await prepareTransaction({
              charon,
              inputs:[],
              outputs: [aliceDepositUtxo],
              account: {
                owner: sender.address,
                publicKey: aliceDepositUtxo.keypair.address(),
              },
              privateChainID: 2,
              myHasherFunc: poseidon,
              myHasherFunc2: poseidon2
            })
            let args = inputData.args
            let extData = inputData.extData
            await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
            const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
            ['bytes','uint256','bytes32'],
            [args.proof,args.publicAmount,args.root]
            );
            let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
            let commi = await getTellorSubmission(args,extData);
            await mockNative2.setAMBInfo(depositId, commi)
            _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
            await charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
            let bobSendAmount = utils.parseEther('4')
            const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
 // contains private and public keys
            const bobAddress = await bobKeypair.address() // contains only public key
            const bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair, chainID: 2 })
            let aliceChangeUtxo = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                myHashFunc: poseidon,
                keypair: aliceDepositUtxo.keypair,
                chainID: 2
            })
            inputData = await prepareTransaction({
                charon: charon2,
                inputs:[aliceDepositUtxo],
                outputs: [bobSendUtxo, aliceChangeUtxo],
                privateChainID: 2,
                myHasherFunc: poseidon,
                myHasherFunc2: poseidon2
              })
            args = inputData.args
            extData = inputData.extData
            assert(await charon2.isSpent(args.inputNullifiers[0]) == false, "should not have spent nulifier")
            await charon2.transact(args,extData)
            assert(await charon2.isSpent(args.inputNullifiers[0]) == true, "should have spent nulifier")
        });
        it("Test _transact and _verify", async function() {
          //can't transact twice on same input, can't use a bogus proof
        let _depositAmount = utils.parseEther('10');
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                  web3.utils.toWei("1000"),
                                                  _depositAmount,
                                                  0)
        
        await token.connect(accounts[1]).approve(charon.address,_amount)
        const sender = accounts[0]
        const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc: poseidon, chainID: 2 })
        const fakeDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc: poseidon, chainID: 3 })
        charon = charon.connect(sender)
        let inputData = await prepareTransaction({
          charon,
          inputs:[],
          outputs: [aliceDepositUtxo],
          account: {
            owner: sender.address,
            publicKey: aliceDepositUtxo.keypair.address(),
          },
          privateChainID: 2,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
        })
        charon = charon.connect(sender)
        let inputDataFake = await prepareTransaction({
          charon,
          inputs:[],
          outputs: [fakeDepositUtxo],
          account: {
            owner: sender.address,
            publicKey: fakeDepositUtxo.keypair.address(),
          },
          privateChainID: 2,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
        })
        let args = inputData.args
        let extData = inputData.extData
        await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10000"))
        await charon.connect(accounts[1]).estimateGas.depositToOtherChain(inputDataFake.args,inputDataFake.extData,false);
        const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
        ['bytes','uint256','bytes32'],
        [args.proof,args.publicAmount,args.root]
        );
        let commi = await getTellorSubmission(args,extData);
        await mockNative2.setAMBInfo(1, commi)
        _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[1]);
        await charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
      commi = await getTellorSubmission(inputDataFake.args,inputDataFake.extData);
        await mockNative2.setAMBInfo(2, commi)
        _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[2]);
        await charon2.oracleDeposit([0],web3.utils.sha3(_encoded, {encoding: 'hex'}));
        // Alice sends some funds to withdraw (ignore bob)
        let bobSendAmount = utils.parseEther('4')
        const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
// contains private and public keys
        const bobAddress = await bobKeypair.address() // contains only public key
        const bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair, chainID: 2})
        let aliceChangeUtxo = new Utxo({
            amount: _depositAmount.sub(bobSendAmount),
            myHashFunc: poseidon,
            keypair: aliceDepositUtxo.keypair,
            chainID: 2
        })
        inputData = await prepareTransaction({
            charon: charon2,
            inputs:[aliceDepositUtxo],
            outputs: [bobSendUtxo, aliceChangeUtxo],
            privateChainID: 2,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
          let failVar = 0;
          try{
            await prepareTransaction({
            charon: charon2,
            inputs:[fakeDepositUtxo],
            outputs: [bobSendUtxo, aliceChangeUtxo],
            privateChainID: 2,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
          failVar = 1;
        }
        catch{
          console.log("failing as expected for fake deposit")
        }
        assert(failVar == 0, "should not allow you to use fake deposit")
        args = inputData.args
        extData = inputData.extData
        await charon2.transact(args,extData)
        await h.expectThrow(charon2.transact(args,extData))
        //add transact16
        const bobSendUtxo2 = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair , chainID: 2})
        let aliceChangeUtxo2 = new Utxo({
            amount: _depositAmount.sub(bobSendAmount),
            myHashFunc: poseidon,
            keypair: aliceChangeUtxo.keypair,
            chainID: 2
        })
        inputData = await prepareTransaction({
            charon: charon2,
            inputs:[aliceChangeUtxo],
            outputs: [bobSendUtxo2, aliceChangeUtxo2],
            privateChainID: 2,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
        args = inputData.args
        extData = inputData.extData
        await charon2.transact(args,extData)
        //second w/ more
        let charlieSendAmount = utils.parseEther('7')
        const charlieKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
        // contains private and public keys
                   const charlieAddress = await charlieKeypair.address() // contains only public key
                   const charlieSendUtxo = new Utxo({ amount: charlieSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(charlieAddress,poseidon), chainID: 2 })
                   let bobChangeUtxo = new Utxo({
                       amount: utils.parseEther('1'),
                       myHashFunc: poseidon,
                       keypair: bobSendUtxo.keypair,
                       chainID: 2
                   })
                   inputData = await prepareTransaction({
                       charon: charon2,
                       inputs:[bobSendUtxo, bobSendUtxo2],
                       outputs: [bobChangeUtxo,charlieSendUtxo],
                       privateChainID: 2,
                       myHasherFunc: poseidon,
                       myHasherFunc2: poseidon2
                     })
                    try{
                      inputDataFake = await prepareTransaction({
                      charon: charon2,
                      inputs:[bobSendUtxo, bobSendUtxo2],
                      outputs: [bobChangeUtxo,charlieSendUtxo],
                      privateChainID: 3,
                      myHasherFunc: poseidon,
                      myHasherFunc2: poseidon2
                    })
                    failVar = 1
                  }
                  catch{
                    console.log("failing as expected for wrong chain")
                  }
                  assert(failVar == 0, "should fail on wrong chain prep")
                   args = inputData.args
                   extData = inputData.extData
                   await charon2.transact(args,extData)
                   await h.expectThrow(charon2.transact(inputDataFake.args,inputDataFake.extData))
                   await h.expectThrow(charon2.transact(args,extData))
    })
async function getTellorSubmission(args,extData){
  const dataEncoded = abiCoder.encode(
    ['bytes32','bytes32','bytes32','bytes32','bytes'],
    [
      args.inputNullifiers[0],
      args.inputNullifiers[1],
      args.outputCommitments[0],
      args.outputCommitments[1],
      args.proof
    ]
  );
  return dataEncoded;
}

});
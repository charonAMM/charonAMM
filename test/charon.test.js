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


async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

async function getTellorData(tInstance, chain,depositID){
    queryData = abiCoder.encode(
        ['string', 'bytes'],
        ['Charon', abiCoder.encode(
            ['uint256','uint256'],
            [chain,depositID]
        )]
        );
        queryId = h.hash(queryData)
        nonce = await tInstance.getNewValueCountbyQueryId(queryId)
        return({queryData: queryData,queryId: queryId,nonce: nonce})
}

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

describe("charon tests", function () {
    let accounts;
    let verifier2,verifier16,token,charon,hasher,token2,charon2,oracle, oracle2;
    let fee = 0;
    let HEIGHT = 5;
    let builtPoseidon;
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
        oracle = await deploy('Oracle',tellor.address)
        oracle2 = await deploy('Oracle',tellor2.address)
        charon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token.address,fee,oracle.address,HEIGHT,1,"Charon Pool Token","CPT")
        await charon.initialize()
        //now deploy on other chain (same chain, but we pretend w/ oracles)
        token2 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        charon2 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,oracle2.address,HEIGHT,2,"Charon Pool Token2","CPT2");
        await charon2.initialize()
        chd = await deploy("MockERC20",charon.address,"charon dollar","chd")
        chd2 = await deploy("MockERC20",charon2.address,"charon dollar2","chd2")
        //now set both of them. 
        await token.approve(charon.address,web3.utils.toWei("100"))//100
        await token2.approve(charon2.address,web3.utils.toWei("100"))//100
        await charon.finalize([2],[charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address);
        await charon2.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd2.address);
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
        assert(await charon.oracle() == oracle.address, "oracle  address should be set")
        assert(await charon.levels() == HEIGHT, "merkle Tree height should be set")
        assert(await charon.hasher() == hasher.address, "hasher should be set")
        assert(await charon.verifier2() == verifier2.address, "verifier2 should be set")
        assert(await charon.verifier16() == verifier16.address, "verifier16 should be set")
        assert(await charon.token() == token.address, "token should be set")
        assert(await charon.fee() == fee, "fee should be set")
        assert(await charon.controller() == accounts[0].address, "controller should be set")
        assert(await charon.chainID() == 1, "chainID should be correct")
      });
      it("Test addLPRewards()", async function() {
        await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
        await h.expectThrow(charon.connect(accounts[1]).addLPRewards(web3.utils.toWei("50"),true))
        await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("50"))
        await charon.connect(accounts[1]).addLPRewards(web3.utils.toWei("50"),true);
        assert(await charon.recordBalanceSynth() == web3.utils.toWei("1050"))
        await token.mint(accounts[1].address,web3.utils.toWei("1000"))
        await h.expectThrow(charon.connect(accounts[1]).addLPRewards(web3.utils.toWei("50"),false))
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("50"))
        await charon.connect(accounts[1]).addLPRewards(web3.utils.toWei("50"),false);
        assert(await charon.recordBalance() == web3.utils.toWei("150"))
      });
      it("Test addUserRewards()", async function() {
        await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
        await h.expectThrow(charon.connect(accounts[1]).addUserRewards(web3.utils.toWei("50"),true))
        await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("50"))
        await charon.connect(accounts[1]).addUserRewards(web3.utils.toWei("50"),true);
        assert(await charon.userRewardsCHD() == web3.utils.toWei("50"))
        await token.mint(accounts[1].address,web3.utils.toWei("1000"))
        await h.expectThrow(charon.connect(accounts[1]).addUserRewards(web3.utils.toWei("50"),false))
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("50"))
        await charon.connect(accounts[1]).addUserRewards(web3.utils.toWei("50"),false);
        assert(await charon.userRewards() == web3.utils.toWei("50"))
      });
      it("Test changeController", async function() {
        await h.expectThrow(charon.connect(accounts[2]).changeController(accounts[2].address))
        await charon.changeController(accounts[1].address)
        assert(await charon.controller() == accounts[1].address, "controller should change")
      });
      it("Test depositToOtherChain", async function() {
        let _depositAmount = web3.utils.toWei("10");
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                  web3.utils.toWei("1000"),
                                                  _depositAmount,
                                                  0)
        
        const sender = accounts[0]
        const aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon })
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
        let testCharon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,tellor2.address,HEIGHT,2,"Charon Pool Token2","CPT2");
        let chd3 = await deploy("MockERC20",testCharon.address,"charon dollar3","chd3")
        await h.expectThrow(testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address));//must transfer token
        await token2.approve(testCharon.address,web3.utils.toWei("100"))//100
        await h.expectThrow(testCharon.connect(accounts[1]).finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address))//must be controller
        await h.expectThrow(testCharon.finalize([1,2],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address))//length should be same
        await testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address);
        await h.expectThrow(testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address))//already finalized
        assert(await testCharon.finalized(), "should be finalized")
        assert(await testCharon.balanceOf(accounts[0].address) - web3.utils.toWei("100") == 0, "should have full balance")
        assert(await testCharon.recordBalance() == web3.utils.toWei("100"), "record Balance should be set")
        assert(await testCharon.recordBalanceSynth() == web3.utils.toWei("1000"), "record Balance synth should be set")
        assert(await testCharon.chd() == chd3.address, "chd should be set")
        let pC = await testCharon.getPartnerContracts();
        assert(pC[0][0] == 1, "partner chain should be correct")
        assert(pC[0][1] == charon.address, "partner address should be correct")
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
      await h.expectThrow(charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10")))
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
      console.log(minOut,await charon.balanceOf(accounts[1].address)*1)
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
        await charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei("4.88"), web3.utils.toWei("48.8"),web3.utils.toWei("4.88"))
        assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("99") > 0, "record balance should be back to correct" )
        assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("99.9") < 1*web3.utils.toWei("1"), "record balance should be back to correct" )
        assert(await charon.balanceOf(accounts[1].address)*1 < web3.utils.toWei("0.01"), "all pool tokens should be gone")
        assert(await token.balanceOf(accounts[1].address)*1 - web3.utils.toWei("99") > 0, "token balance should be back to correct" )
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
        const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc:poseidon })
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
        let tellorData = await getTellorData(tellor2,1,depositId) 
        let commi = await getTellorSubmission(args,extData);
        await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
        await h.advanceTime(43200)//12 hours
        let tx = await charon2.oracleDeposit([1],[1]);
        assert(await charon2.isSpent(args.inputNullifiers[0]) == true ,"nullifierHash should be true")
        assert(await charon2.isSpent(args.inputNullifiers[1]) == true ,"nullifierHash should be true")
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
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc: poseidon })
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
            let tellorData = await getTellorData(tellor2,1,depositId) 
            let commi = await getTellorSubmission(args,extData);
            await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
            await h.advanceTime(43200)//12 hours
            let tx = await charon2.oracleDeposit([1],[1]);  
            // Alice sends some funds to withdraw (ignore bob)
            let bobSendAmount = utils.parseEther('4')
            const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
 // contains private and public keys
            const bobAddress = await bobKeypair.address() // contains only public key
            const bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(bobAddress,poseidon) })
            let aliceChangeUtxo = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                myHashFunc: poseidon,
                keypair: aliceDepositUtxo.keypair,
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
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon })
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
            let tellorData = await getTellorData(tellor2,1,depositId) 
            let commi = await getTellorSubmission(args,extData);
            await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
            await h.advanceTime(43200)//12 hours
            let tx = await charon2.oracleDeposit([1],[1]);  
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
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc: poseidon })
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
            let tellorData = await getTellorData(tellor2,1,depositId) 
            let commi = await getTellorSubmission(args,extData);
            await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
            await h.advanceTime(43200)//12 hours
            gas = await charon2.estimateGas.oracleDeposit([1],[1]);
            console.log('oracleDeposit', gas - 0)
            let tx = await charon2.oracleDeposit([1],[1]);  
            // Alice sends some funds to withdraw (ignore bob)
            let bobSendAmount = utils.parseEther('4')
            const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
 // contains private and public keys
            const bobAddress = await bobKeypair.address() // contains only public key
            const bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair })
            let aliceChangeUtxo = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                myHashFunc: poseidon,
                keypair: aliceDepositUtxo.keypair,
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
            const bobSendUtxo2 = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair })
            let aliceChangeUtxo2 = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                myHashFunc: poseidon,
                keypair: aliceChangeUtxo.keypair,
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
                       const charlieSendUtxo = new Utxo({ amount: charlieSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(charlieAddress,poseidon) })
                       let bobChangeUtxo = new Utxo({
                           amount: utils.parseEther('1'),
                           myHashFunc: poseidon,
                           keypair: bobSendUtxo.keypair,
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
        it("Test getTokens()", async function() {
          let toks = await charon.getTokens()
          assert(toks[0] == chd.address, "chd should be slot 0")
          assert(toks[1] == token.address, "token should be slot 1")
        });
  
});
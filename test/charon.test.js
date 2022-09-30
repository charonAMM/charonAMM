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
//const { hAbi, hbytecode } = require("../artifacts/contracts/Hasher.sol/Hasher.json")
const h = require("usingtellor/test/helpers/helpers.js");
require('../scripts/compileHasher')

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
      ['bytes','uint256','bytes32','uint256','bytes32[]','bytes32[2]','address','int256','address','uint256'],
      [
        args.proof,
        args.publicAmount,
        args.root,
        args.extDataHash,
        args.inputNullifiers,
        args.outputCommitments,
        extData.recipient,
        extData.extAmount,
        extData.relayer,
        extData.fee
      ]
    );
    return dataEncoded;
  }

describe("charon tests", function () {
    let accounts;
    let verifier2,verifier16,token,charon,hasher,token2,charon2;
    let fee = 0;
    let HEIGHT = 5;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        verifier2 = await deploy('Verifier2')
        verifier16 = await deploy('Verifier16')
        //hasher = await deploy('Hasher')
        let Hasher = await ethers.getContractFactory(HASH.abi, HASH.bytecode);
        hasher = await Hasher.deploy();
        token = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey","DSM")
        await token.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        //deploy tellor
        let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor = await TellorOracle.deploy();
        tellor2 = await TellorOracle.deploy();
        await tellor2.deployed();
        await tellor.deployed();
        charon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token.address,fee,tellor.address,HEIGHT,1,"Charon Pool Token","CPT")
        //now deploy on other chain (same chain, but we pretend w/ oracles)
        token2 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        charon2 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,tellor2.address,HEIGHT,2,"Charon Pool Token2","CPT2");
        chd = await deploy("MockERC20",charon.address,"charon dollar","chd")
        chd2 = await deploy("MockERC20",charon2.address,"charon dollar2","chd2")
        //now set both of them. 
        await token.approve(charon.address,web3.utils.toWei("100"))//100
        await token2.approve(charon2.address,web3.utils.toWei("100"))//100
        await charon.finalize([2],[charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address);
        await charon2.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd2.address);
    });
    // it("generates same poseidon hash", async function () {
    //     const res = await hasher["poseidon(bytes32[2])"]([toFixedHex(1,32), toFixedHex(1,32)]);
    //     const res2 = poseidonHash([toFixedHex(1,32), toFixedHex(1,32)]);
    //     assert(res - res2 == 0, "should be the same hash");
    // }).timeout(500000);
    // it("Test Constructor", async function() {
    //     assert(await charon.tellor() == tellor.address, "oracle  address should be set")
    //     assert(await charon.levels() == HEIGHT, "merkle Tree height should be set")
    //     assert(await charon.hasher() == hasher.address, "hasher should be set")
    //     assert(await charon.verifier2() == verifier2.address, "verifier2 should be set")
    //     assert(await charon.verifier16() == verifier16.address, "verifier16 should be set")
    //     assert(await charon.token() == token.address, "token should be set")
    //     assert(await charon.fee() == fee, "fee should be set")
    //     assert(await charon.controller() == accounts[0].address, "controller should be set")
    //     assert(await charon.chainID() == 1, "chainID should be correct")
    //   });
    //   it("Test changeController", async function() {
    //     await charon.changeController(accounts[1].address)
    //     assert(await charon.controller() == accounts[1].address, "controller should change")
    //   });

    //   it("Test depositToOtherChain", async function() {
    //     let _depositAmount = web3.utils.toWei("10");
    //     await token.mint(accounts[1].address,web3.utils.toWei("100"))
    //     let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
    //                                               web3.utils.toWei("1000"),
    //                                               _depositAmount,
    //                                               0)
        
    //     await token.connect(accounts[1]).approve(charon.address,_amount)
    //     const sender = accounts[0]
    //     const aliceDepositUtxo = new Utxo({ amount: _depositAmount })
    //     charon = charon.connect(sender)
    //     let inputData = await prepareTransaction({
    //       charon,
    //       inputs:[],
    //       outputs: [aliceDepositUtxo],
    //       account: {
    //         owner: sender.address,
    //         publicKey: aliceDepositUtxo.keypair.address(),
    //       },
    //       privateChainID: 2
    //     })
    //     let args = inputData.args
    //     let extData = inputData.extData
    //     await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
    //     let commi = await charon.getDepositCommitmentsById(1);
    //     assert(commi[1].proof == args.proof, "commitment a should be stored")
    //     assert(commi[1].publicAmount - args.publicAmount == 0, "commitment publicAmount should be stored")
    //     assert(commi[1].root == args.root, "commitment root should be stored")
    //     assert(commi[1].inputNullifiers[0] == args.inputNullifiers[0], "commitment inputNullifiers should be stored")
    //     assert(commi[1].inputNullifiers[1] == args.inputNullifiers[1], "commitment inputNullifiers should be stored")
    //     assert(commi[1].outputCommitments[0] == args.outputCommitments[0], "commitment outputCommitments should be stored")
    //     assert(commi[1].outputCommitments[1] == args.outputCommitments[1], "commitment outputCommitments should be stored")
    //     assert(commi[1].extDataHash - args.extDataHash == 0, "commitment extDataHash should be stored")
    //     assert(commi[0].recipient == extData.recipient, "extData should be correct");
    //     assert(commi[0].extAmount - extData.extAmount == 0, "extDataAmount should be correct");
    //     assert(commi[0].relayer == extData.relayer, "extData should be correct");
    //     assert(commi[0].fee - extData.fee == 0, "extData fee should be correct");
    //     const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
    //       ['bytes','uint256','bytes32'],
    //       [args.proof,args.publicAmount,args.root]
    //     );
    //     assert(await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded)) == 1, "reverse commitment mapping should work")
    //     assert(await charon.recordBalance() * 1 -(1* web3.utils.toWei("100") + 1 * _amount) == 0, "recordBalance should go up")
    //     assert(await token.balanceOf(accounts[1].address) == web3.utils.toWei("100") - _amount, "balance should change properly")
    //   });
    //   it("Test finalize", async function() {
    //     let testCharon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,tellor2.address,HEIGHT,2,"Charon Pool Token2","CPT2");
    //     let chd3 = await deploy("MockERC20",testCharon.address,"charon dollar3","chd3")
    //     await token2.approve(testCharon.address,web3.utils.toWei("100"))//100
    //     await h.expectThrow(testCharon.connect(accounts[1]).finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address))//must be controller
    //     await testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address);
    //     await h.expectThrow(testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address))//already finalized
    //     assert(await testCharon.finalized(), "should be finalized")
    //     assert(await testCharon.balanceOf(accounts[0].address) - web3.utils.toWei("100") == 0, "should have full balance")
    //     let pC = await testCharon.getPartnerContracts();
    //     assert(pC[0][0] == 1, "partner chain should be correct")
    //     assert(pC[0][1] == charon.address, "partner address should be correct")
    //   });
    // it("Test lpDeposit", async function() {
    //   await token.mint(accounts[1].address,web3.utils.toWei("100"))
    //   await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
    //   await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
    //   await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
    //   let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
    //                                         web3.utils.toWei("100"),//poolSupply
    //                                         web3.utils.toWei("10")//tokenamountIn
    //                                         )
    //   assert(minOut >= web3.utils.toWei("4.88"), "should be greater than this")
    //   await charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
    //   assert(await charon.recordBalance() - web3.utils.toWei("104.88") > 0, "record balance should be correct")
    //   assert(await charon.recordBalance() - web3.utils.toWei("104.88") < web3.utils.toWei("1"), "record balance should be correct")
    //   assert(await charon.recordBalanceSynth() - web3.utils.toWei("1048.8")> 0, "record balance synth should be correct")
    //   assert(await charon.recordBalanceSynth() - web3.utils.toWei("1048.8")< web3.utils.toWei("1"), "record balance synth should be correct")
    //   assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei("4.88") > 0 , "mint of tokens should be correct")
    //   assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei("4.88") < web3.utils.toWei(".01") , "mint of tokens should be correct")
    //   assert(await token.balanceOf(accounts[1].address)*1 +  web3.utils.toWei("4.88") -  web3.utils.toWei("100") > 0, "contract should take tokens")
    //   assert(await chd.balanceOf(accounts[1].address)*1 + web3.utils.toWei("48.8") - web3.utils.toWei("1000") > 0, "contractsynth should take tokens")
    //   let tbal = await token.balanceOf(accounts[1].address)
    //   assert((tbal*1) +  1* web3.utils.toWei("4.88") -  1* web3.utils.toWei("100") < 1* web3.utils.toWei("0.1"), "contract should take tokens")
    //   assert(await chd.balanceOf(accounts[1].address)*1 + 1* web3.utils.toWei("48.8") - 1* web3.utils.toWei("1000") < web3.utils.toWei("0.1"), "contractsynth should take tokens")
    // });
    // it("Test lpWithdraw", async function() {
    //     await token.mint(accounts[1].address,web3.utils.toWei("100"))
    //     await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
    //     await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
    //     await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
    //     let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
    //                                           web3.utils.toWei("100"),//poolSupply
    //                                           web3.utils.toWei("10")//tokenamountIn
    //                                           )
    //     await charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
    //     let poolSupply = await charon.totalSupply()
    //     await charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei("4.88"), web3.utils.toWei("48.8"),web3.utils.toWei("4.88"))
    //     assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("99") > 0, "record balance should be back to correct" )
    //     assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("99.9") < 1*web3.utils.toWei("1"), "record balance should be back to correct" )
    //     assert(await charon.balanceOf(accounts[1].address)*1 < web3.utils.toWei("0.01"), "all pool tokens should be gone")
    //     assert(await token.balanceOf(accounts[1].address)*1 - web3.utils.toWei("99") > 0, "token balance should be back to correct" )
    //     assert(web3.utils.toWei("101") - await token.balanceOf(accounts[1].address)*1 > 0, "token balance should be back to correct" )
    //     });

    it("Test oracleDeposit", async function() {
        let _depositAmount = web3.utils.toWei("10");
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                  web3.utils.toWei("1000"),
                                                  _depositAmount,
                                                  0)
        
        await token.connect(accounts[1]).approve(charon.address,_amount)
        const sender = accounts[0]
        const aliceDepositUtxo = new Utxo({ amount: _depositAmount })
        charon = charon.connect(sender)
        let inputData = await prepareTransaction({
          charon,
          inputs:[],
          outputs: [aliceDepositUtxo],
          account: {
            owner: sender.address,
            publicKey: aliceDepositUtxo.keypair.address(),
          },
          privateChainID: 2
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
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount })
            charon = charon.connect(sender)
            let inputData = await prepareTransaction({
              charon,
              inputs:[],
              outputs: [aliceDepositUtxo],
              account: {
                owner: sender.address,
                publicKey: aliceDepositUtxo.keypair.address(),
              },
              privateChainID: 2
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
            const bobKeypair = new Keypair() // contains private and public keys
 // contains private and public keys
            const bobAddress = bobKeypair.address() // contains only public key
        
            const bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(bobAddress) })

            let aliceChangeUtxo = new Utxo({
                amount: _depositAmount.sub(bobSendAmount),
                keypair: aliceDepositUtxo.keypair,
            })

            inputData = await prepareTransaction({
                charon: charon2,
                inputs:[aliceDepositUtxo],
                outputs: [bobSendUtxo, aliceChangeUtxo],
                privateChainID: 2
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
                bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
            } catch (e) {
            // we try to decrypt another output here because it shuffles outputs before sending to blockchain
                bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index)
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
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount })
            charon = charon.connect(sender)
            let inputData = await prepareTransaction({
              charon,
              inputs:[],
              outputs: [aliceDepositUtxo],
              account: {
                owner: sender.address,
                publicKey: aliceDepositUtxo.keypair.address(),
              },
              privateChainID: 2
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
                privateChainID: 2
            })
            await charon2.transact(inputData.args,inputData.extData)
            assert(await chd2.balanceOf(accounts[1].address) - _depositAmount == 0, "should mint CHD");
        })
});
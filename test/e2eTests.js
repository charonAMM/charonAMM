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
    
    async function getTellorData(tInstance,cAddress,chain,depositID){
    let ABI = ["function getOracleSubmission(uint256 _depositId)"];
    let iface = new ethers.utils.Interface(ABI);
    let funcSelector = iface.encodeFunctionData("getOracleSubmission", [depositID])

    queryData = abiCoder.encode(
        ['string', 'bytes'],
        ['EVMCall', abiCoder.encode(
            ['uint256','address','bytes'],
            [chain,cAddress,funcSelector]
        )]
        );
        queryId = h.hash(queryData)
        nonce = await tInstance.getNewValueCountbyQueryId(queryId)
        return({queryData: queryData,queryId: queryId,nonce: nonce})
}
describe("e2e charon tests", function () {
    let accounts;
    let verifier2,verifier16,token,charon,hasher,token2,charon2,oracle, oracle2,cfc,cfc2;
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
        //now deploy on other chain (same chain, but we pretend w/ oracles)
        token2 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        charon2 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,oracle2.address,HEIGHT,2,"Charon Pool Token2","CPT2");
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

    it("can you oracleDeposit same id twice", async function() {
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
      let tellorData = await getTellorData(tellor2,charon.address,1,depositId) 
      let commi = await getTellorSubmission(args,extData);
      await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43200)//12 hours
      let tx = await charon2.oracleDeposit([1],0);
      await h.expectThrow(charon2.oracleDeposit([1],0))
    })
    it("Oracle attack (bad value pushed through, it can break it if oracle fails!!", async function() {

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
      //await charon.connect(accounts[1]).depositToOtherChain(args,extData,false); (comment out the deposit part)
      const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      ['bytes','uint256','bytes32'],
      [args.proof,args.publicAmount,args.root]
      );
      let depositId = 1
      let tellorData = await getTellorData(tellor2,charon.address,1,depositId) 
      let commi = await getTellorSubmission(args,extData);
      await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43200)//12 hours
      let tx = await charon2.oracleDeposit([1],0);  
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
    it("pulls all liquidity", async function() {
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
            let tellorData = await getTellorData(tellor2,charon.address,1,depositId) 
            let commi = await getTellorSubmission(args,extData);
            await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
            await h.advanceTime(43200)//12 hours
            let tx = await charon2.oracleDeposit([1],0);  
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
            await charon2.transact(args,extData)
            let bal1 = await token2.balanceOf(accounts[0].address);
            let chdbal1 = await chd2.balanceOf(accounts[0].address)
            await charon2.lpWithdraw(web3.utils.toWei("100"), web3.utils.toWei("999"),web3.utils.toWei("99"))
            assert(web3.utils.toWei("1000000") - await token2.balanceOf(accounts[0].address)*1 <web3.utils.toWei(".01"), "should withdraw all tokens")
            assert(web3.utils.toWei("1000") - 1*await chd2.balanceOf(accounts[0].address)*1  < web3.utils.toWei(".01") , "should withdraw all chd")
            assert(await charon2.totalSupply() == 0, "all pool tokens should be gone")
    })
    // it("underlying token freezes (tellor upgrade example), allow single sided withdraw", async function() {
    // })
    // it("Multiple back and forths (oracle deposits on 3 different chains and withdrawals and trades)", async function() {
    // })
    // it("Lots of chains, lots of privacy transactioins, lots of withdrawals", async function() {
    // })
    it("No way to send money and then withdraw on old UTXO", async function() {
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
      let tellorData = await getTellorData(tellor2,charon.address,1,depositId) 
      let commi = await getTellorSubmission(args,extData);
      await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43200)//12 hours
      let tx = await charon2.oracleDeposit([1],0);  
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
      oldInputData = await prepareTransaction({
        charon: charon2,
        inputs: [aliceDepositUtxo],
        outputs: [],
        recipient: accounts[1].address,
        privateChainID: 2,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
    })
    await h.expectThrow(charon2.transact(oldInputData.args,oldInputData.extData))
    })
    it("No way to withdraw more than you put in", async function() {
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
      let tellorData = await getTellorData(tellor2,charon.address,1,depositId) 
      let commi = await getTellorSubmission(args,extData);
      await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43200)//12 hours
      let tx = await charon2.oracleDeposit([1],0);  
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
      let fakeUTXO = new Utxo({ amount: web3.utils.toWei("500"),myHashFunc: poseidon, keypair: aliceDepositUtxo.keypair, chainID: 2 })
      let fakeInputData = await prepareTransaction({
        charon: charon2,
        inputs: [fakeUTXO],
        outputs: [],
        recipient: accounts[1].address,
        privateChainID: 2,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2,
        test: true
      })
      await h.expectThrow(charon2.transact(fakeInputData.args,fakeInputData.extData))
      await charon2.transact(inputData.args,inputData.extData)
      await h.expectThrow(charon2.transact(inputData.args,inputData.extData))
      assert(await chd2.balanceOf(accounts[1].address) - _depositAmount == 0, "should mint CHD");
    })
    it("Attempt to swap out of massive position", async function() {
      //try to do more than in the pool, assert fail
      await token.mint(accounts[1].address,web3.utils.toWei("1000"))
      await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("1000"))
      await h.expectThrow(charon.connect(accounts[1]).swap(false,web3.utils.toWei("1000"),0,web3.utils.toWei("50000")))
      //do slightly less (find break point)
      await h.expectThrow(charon.connect(accounts[1]).swap(false,web3.utils.toWei("100"),0,web3.utils.toWei("50000")))
      await h.expectThrow(charon.connect(accounts[1]).swap(false,web3.utils.toWei("80"),0,web3.utils.toWei("50000")))
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      await charon.connect(accounts[1]).swap(false,web3.utils.toWei("30"),0,web3.utils.toWei("50000"))
    })
    it("Add rewards and pay them out", async function() {
      //mint chd and token on both chains
      await token.mint(accounts[1].address,web3.utils.toWei("1000000"))//1M
      await chd.mint(accounts[1].address,web3.utils.toWei("1000000"))//1M
      await token2.mint(accounts[1].address,web3.utils.toWei("1000000"))//1M
      await chd2.mint(accounts[1].address,web3.utils.toWei("1000000"))//1M

      //add rewards to both charon systems, assert balances change properly
      await token.connect(accounts[1]).approve(charon.address, web3.utils.toWei("300000"))
      await token2.connect(accounts[1]).approve(charon2.address, web3.utils.toWei("300000"))
      await chd.connect(accounts[1]).approve(charon.address, web3.utils.toWei("300000"))
      await chd2.connect(accounts[1]).approve(charon2.address, web3.utils.toWei("300000"))
      await charon.connect(accounts[1]).addRewards(web3.utils.toWei("100000"),web3.utils.toWei("100000"),web3.utils.toWei("100000"),true)
      await charon.connect(accounts[1]).addRewards(web3.utils.toWei("100000"),web3.utils.toWei("100000"),web3.utils.toWei("100000"),false)
      await charon2.connect(accounts[1]).addRewards(web3.utils.toWei("100000"),web3.utils.toWei("100000"),web3.utils.toWei("100000"),true)
      await charon2.connect(accounts[1]).addRewards(web3.utils.toWei("100000"),web3.utils.toWei("100000"),web3.utils.toWei("100000"),false)
      assert(await charon.recordBalanceSynth() == web3.utils.toWei("101000"), "new recordBalance Synth should be correct")
      assert(await charon.recordBalance() == web3.utils.toWei("100100"), "new recordBalance should be correct")
      assert(await charon.oracleCHDFunds() == web3.utils.toWei("100000"), "new oracleCHD funds should be correct")
      assert(await charon.oracleTokenFunds() == web3.utils.toWei("100000"), "new oracleToken funds should be correct")
      assert(await charon.userRewardsCHD() == web3.utils.toWei("100000"), "new userRewardsCHD should be correct")
      assert(await charon.userRewards() == web3.utils.toWei("100000"), "new userRewards should be correct")

      //deposit twice and assert correct user rewards
      let _depositAmount = web3.utils.toWei("10");
      await token.mint(accounts[3].address,web3.utils.toWei("100"))
      let _amount = await charon.calcInGivenOut(web3.utils.toWei("100100"),
                                                web3.utils.toWei("101000"),
                                                _depositAmount,
                                                0)
      
      let sender = accounts[3]
      let aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon , chainID: 2})
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
      await token.connect(accounts[3]).approve(charon.address,_amount)
      await charon.connect(accounts[3]).depositToOtherChain(args,extData,false);
      let userW = _amount/50
      assert((await token.balanceOf(accounts[3].address)*1  + 1*_amount)  - _amount/50- web3.utils.toWei("100") == 0, "token balance should be correct")
      assert(await chd.balanceOf(accounts[3].address) - _amount/50 ==0, "chd balance should be correct")
      assert(await charon.userRewards() - (web3.utils.toWei("100000") - userW) > 0, "user rewards should properly subtract")
      assert(await charon.userRewards() - (web3.utils.toWei("100000") - userW) < web3.utils.toWei(".01"), "user rewards should properly subtract")
      assert(await charon.userRewardsCHD() - (web3.utils.toWei("100000") - userW) > 0, "user rewards chd should properly subtract")
      assert(await charon.userRewardsCHD() - (web3.utils.toWei("100000") - userW) < web3.utils.toWei(".01"), "user rewardschd should properly subtract")
      await token.mint(accounts[4].address,web3.utils.toWei("100"))
      let rec = await charon.recordBalance()
      let recS = await charon.recordBalanceSynth()
      _amount = await charon.calcInGivenOut(rec,
                                                recS,
                                                _depositAmount,
                                                0)
      
      sender = accounts[4]
      aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon , chainID: 2})
      charon = charon.connect(sender)
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
      let args2 = inputData.args
      let extData2 = inputData.extData
      await token.connect(accounts[4]).approve(charon.address,_amount)
      await charon.connect(accounts[4]).depositToOtherChain(args2,extData2,false);
      let _payamount = _amount/50
      assert((await token.balanceOf(accounts[4].address)*1  + 1*_amount)  - _amount/50- web3.utils.toWei("100") == 0, "token balance should be correct2")
      assert(await chd.balanceOf(accounts[4].address) - _amount/50 < web3.utils.toWei("0.01"), "chd balance should be correct2")
      assert(await chd.balanceOf(accounts[4].address) - _amount/50 > 0 , "chd balance should be correct2")
      assert(await charon.userRewards()  - (web3.utils.toWei("100000") - _payamount - userW) > 0, "user rewards should properly subtract2")
      assert(await charon.userRewards()  - (web3.utils.toWei("100000") - _payamount - userW) < web3.utils.toWei(".001"), "user rewards should properly subtract2")
      assert(await charon.userRewardsCHD() - (web3.utils.toWei("100000") - _payamount - userW) > 0, "user rewards chd should properly subtract2")
      assert(await charon.userRewardsCHD() - (web3.utils.toWei("100000") - _payamount - userW) < web3.utils.toWei(".001"), "user rewards chd should properly subtract2")
      //move both pieces of data over and assert correct oracle rewards
      const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
        ['bytes','uint256','bytes32'],
        [args.proof,args.publicAmount,args.root]
        );
        let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
        let tellorData = await getTellorData(tellor2,charon.address,1,depositId) 
        let commi = await getTellorSubmission(args,extData);
        await tellor2.connect(accounts[5]).submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
        tellorData = await getTellorData(tellor2,charon.address,1,2) 
        commi = await getTellorSubmission(args2,extData2);
        await tellor2.connect(accounts[6]).submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
        await h.advanceTime(43200)//12 hours
        await charon2.oracleDeposit([1,2],0);//should get both
        assert(await token2.balanceOf(accounts[5].address) == web3.utils.toWei("100"), "token balance should be correct2")
        assert(await chd2.balanceOf(accounts[5].address) ==  web3.utils.toWei("100"), "chd balance should be correct2")
        assert(await token2.balanceOf(accounts[6].address) == web3.utils.toWei("99.9"), "token balance should be correct2 - 2")
        assert(await chd2.balanceOf(accounts[6].address) == web3.utils.toWei("99.9"), "chd balance should be correct2 -2")
        assert(await charon2.oracleTokenFunds() - (web3.utils.toWei("100000") - web3.utils.toWei("99.9") - web3.utils.toWei("100")) > 0, "user rewards should properly subtract2")
        assert(await charon2.oracleTokenFunds() - (web3.utils.toWei("100000") - web3.utils.toWei("99.9") - web3.utils.toWei("100")) < web3.utils.toWei(".001"), "user rewards should properly subtract2")
        assert(await charon2.oracleCHDFunds() - (web3.utils.toWei("100000") - web3.utils.toWei("99.9") - web3.utils.toWei("100")) > 0, "user rewards should properly subtract2")
        assert(await charon2.oracleCHDFunds() - (web3.utils.toWei("100000") - web3.utils.toWei("99.9") - web3.utils.toWei("100")) < web3.utils.toWei(".001"), "user rewards should properly subtract2")
    })
    it("Test distribution of base fee", async function() {
      fee = web3.utils.toWei(".02");//2%
      let charon3 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token.address,fee,oracle.address,HEIGHT,1,"Charon Pool Token","CPT")
      let charon4 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,oracle2.address,HEIGHT,2,"Charon Pool Token2","CPT2");
      chd3 = await deploy("MockERC20",charon3.address,"charon dollar","chd")
      chd4 = await deploy("MockERC20",charon4.address,"charon dollar2","chd2")
      let cfc3 = await deploy('MockCFC',token.address,chd3.address)
      let cfc4 = await deploy('MockCFC',token2.address,chd4.address)
      //now set both of them. 
      await token.approve(charon3.address,web3.utils.toWei("100"))//100
      await token2.approve(charon4.address,web3.utils.toWei("100"))//100
      await charon3.finalize([2],[charon4.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address,cfc3.address);
      await charon4.finalize([1],[charon3.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd4.address,cfc4.address);
      //make several LP's 

      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      await token.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("10"))
      await chd3.mint(accounts[1].address,web3.utils.toWei("1000"))
      let minOut = await charon3.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
          web3.utils.toWei("100"),//poolSupply
          web3.utils.toWei("10")//tokenamountIn
          )
      await chd3.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("100"))
      await charon3.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
      await token.mint(accounts[2].address,web3.utils.toWei("100"))
      await token.connect(accounts[2]).approve(charon3.address,web3.utils.toWei("10"))
      await chd3.mint(accounts[2].address,web3.utils.toWei("1000"))
      await chd3.connect(accounts[2]).approve(charon3.address,web3.utils.toWei("100"))
      await charon3.connect(accounts[2]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))

      //make a swap, assert that fee went to CFC
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      await token.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("10"))
      await charon3.connect(accounts[1]).swap(false,web3.utils.toWei("10"),0,web3.utils.toWei("99999"))//accept any min/max price/amount
      assert(await token.balanceOf(cfc3.address) == web3.utils.toWei(".2"))
      //make a swap from chd, assert that fee went to cfc
      await chd4.mint(accounts[1].address,web3.utils.toWei("100"))
      await chd4.connect(accounts[1]).approve(charon4.address,web3.utils.toWei("10"))
      await charon4.connect(accounts[1]).swap(true,web3.utils.toWei("10"),0,web3.utils.toWei("99999"))
      assert(await chd4.balanceOf(cfc4.address) == web3.utils.toWei(".2"), "chd 4 balance should be correct")
      assert(await token.balanceOf(cfc4.address) == 0, "token cfc balance should be correct")

      //make LPwithdraw, assert fee went to CFC
      let bal1 = await chd3.balanceOf(accounts[1].address)
      await charon3.connect(accounts[1]).lpWithdraw(web3.utils.toWei("4.88"),0,0)
      let bal2 = await chd3.balanceOf(accounts[1].address)
      assert(await token.balanceOf(cfc3.address) - web3.utils.toWei(".3") < web3.utils.toWei(".01"), "token balance should be correct")
      assert(await token.balanceOf(cfc3.address) - web3.utils.toWei(".3") > 0, "token balance should be correct")
      assert(await chd3.balanceOf(cfc3.address)  - ((bal2 -bal1) * .02) > 0, "chd balance should change properly" )
      assert(await chd3.balanceOf(cfc3.address)  - ((bal2 -bal1) * .02) < web3.utils.toWei(".02"), "chd balance should change properly" )
      //withdraw singleLP, assert fee went to CFC
      await chd4.mint(accounts[1].address,web3.utils.toWei("1000"))
      await token2.mint(accounts[1].address,web3.utils.toWei("1000"))
      await chd4.connect(accounts[1]).approve(charon4.address,web3.utils.toWei("1000"))
      await token2.connect(accounts[1]).approve(charon4.address,web3.utils.toWei("1000"))
      await charon4.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("50"),web3.utils.toWei("5"))
      let ptokens = await charon4.balanceOf(accounts[1].address)
      await charon4.connect(accounts[1]).lpWithdrawSingleCHD(ptokens,0)
      assert(await chd4.balanceOf(cfc4.address) > web3.utils.toWei("2.1"), "chd should be correct after single lpWithdraw")
      assert(await chd4.balanceOf(cfc4.address) < web3.utils.toWei("2.11"), "chd should be correct after single lpWithdraw")
    })
});
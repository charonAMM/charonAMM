const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect, assert } = require('chai')
const { utils } = ethers
const web3 = require('web3');
const abiCoder = new ethers.utils.AbiCoder()
const Utxo = require('../src/utxo')
const { prepareTransaction } = require('../src/index')
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
    it("underlying token freezes (tellor upgrade example), allow single sided withdraw", async function() {
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
            let chdbal1 = await token2.balanceOf(charon.address)
            await charon2.connect(accounts[0]).lpWithdrawSingleCHD(web3.utils.toWei("98"), 0)
            assert((await charon2.recordBalance()*1) - 1*web3.utils.toWei("100") == 0, "record balance should not move" )
            assert((await charon2.recordBalanceSynth()*1) - 1*web3.utils.toWei(".4") == 0 , "record balance synth should be back to correct" )
            assert(await charon2.balanceOf(accounts[0].address)*1 == web3.utils.toWei("2"), "all pool tokens should be gone")
            assert(await token2.balanceOf(accounts[0].address)*1 -bal1 == 0, "token balance should not move" )
            assert(await token2.balanceOf(charon.address)*1 - chdbal1 == 0, "token balance should be same at charon" )
            assert(web3.utils.toWei("1000") - 1*await chd2.balanceOf(accounts[0].address)*1  < web3.utils.toWei("2") , "should withdraw all chd")
            assert(await charon2.totalSupply() == web3.utils.toWei("2"), "all(most) pool tokens should be gone")
    })
    it("Multiple back and forths (oracle deposits on 3 different chains and withdrawals and trades)", async function() {
      console.log("starting long e2e test....")
      //start 3 systems
      let TellorOracle = await ethers.getContractFactory(abi, bytecode);
      let tellor3 = await TellorOracle.deploy();
      await tellor3.deployed();
      let oracle3 = await deploy('Oracle',tellor3.address)
      charon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token.address,fee,oracle.address,HEIGHT,1,"Charon Pool Token","CPT")
      let token3 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
      await token3.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
      charon2 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,oracle2.address,HEIGHT,2,"Charon Pool Token2","CPT2");
      let charon3 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token3.address,fee,oracle3.address,HEIGHT,3,"Charon Pool Token2","CPT2");
      chd = await deploy("MockERC20",charon.address,"charon dollar","chd")
      chd2 = await deploy("MockERC20",charon2.address,"charon dollar2","chd2")
      let chd3 = await deploy("MockERC20",charon3.address,"charon dollar3","chd3") 
      await chd.deployed()
      await chd2.deployed();
      await chd3.deployed();
      await token.approve(charon.address,web3.utils.toWei("100"))//100
      await token2.approve(charon2.address,web3.utils.toWei("100"))//100
      await token3.approve(charon3.address,web3.utils.toWei("100"))
      cfc = await deploy('MockCFC',token.address,chd.address)
      cfc2 = await deploy('MockCFC',token2.address,chd2.address)
      cfc3 = await deploy('MockCFC',token3.address,chd3.address)
      await cfc.deployed();
      await cfc2.deployed();
      await cfc3.deployed();
      await charon.finalize([2,3],[charon2.address, charon3.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address,cfc.address);
      await charon2.finalize([1,3],[charon.address,charon3.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd2.address, cfc2.address);
      await charon3.finalize([1,2],[charon.address,charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address, cfc3.address);
      //deposit from 1 to 2
      let _depositAmount = utils.parseEther('10');
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token.connect(accounts[1]).approve(charon.address,_amount)
      let aliceDepositUtxo12 = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 2 })
      let inputData = await prepareTransaction({
        charon: charon,
        inputs:[],
        outputs: [aliceDepositUtxo12],
        account: {
          owner: accounts[0].address,
          publicKey: aliceDepositUtxo12.keypair.address(),
        },
        privateChainID: 2,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      let args = inputData.args
      let extData = inputData.extData
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
      let dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      ['bytes','uint256','bytes32'],
      [args.proof,args.publicAmount,args.root]
      );
      let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
      let tellorData = await getTellorData(tellor2,charon.address,1,depositId) 
      let commi = await getTellorSubmission(args,extData);
      await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43200)//12 hours
      let tx = await charon2.oracleDeposit([1],0);  
      //deposit from 1 to 3
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      _amount = await charon.calcInGivenOut(web3.utils.toWei("110"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token.connect(accounts[1]).approve(charon.address,_amount)
      let aliceDepositUtxo13 = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 3 })
      inputData = await prepareTransaction({
        charon: charon,
        inputs:[],
        outputs: [aliceDepositUtxo13],
        account: {
          owner: accounts[0].address,
          publicKey: aliceDepositUtxo13.keypair.address(),
        },
        privateChainID: 3,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      args = inputData.args
      extData = inputData.extData
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
      dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      ['bytes','uint256','bytes32'],
      [args.proof,args.publicAmount,args.root]
      );
      depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
      tellorData = await getTellorData(tellor3,charon.address,1,depositId) 
      commi = await getTellorSubmission(args,extData);
      await tellor3.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43200)//12 hours
      tx = await charon3.oracleDeposit([2],0);  //deposit id , from chain 1
      //deposit from 2 to 1
      await token2.mint(accounts[1].address,web3.utils.toWei("100"))
      _amount = await charon2.calcInGivenOut(web3.utils.toWei("100"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token2.connect(accounts[1]).approve(charon2.address,_amount)
      let aliceDepositUtxo21 = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 1 })
      inputData = await prepareTransaction({
        charon: charon2,
        inputs:[],
        outputs: [aliceDepositUtxo21],
        account: {
          owner: accounts[0].address,
          publicKey: aliceDepositUtxo21.keypair.address(),
        },
        privateChainID: 1,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      args = inputData.args
      extData = inputData.extData
      await charon2.connect(accounts[1]).depositToOtherChain(args,extData,false);
      dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      ['bytes','uint256','bytes32'],
      [args.proof,args.publicAmount,args.root]
      );
      depositId = await charon2.getDepositIdByCommitmentHash(h.hash(dataEncoded))
      tellorData = await getTellorData(tellor,charon2.address,2,depositId) 
      commi = await charon2.getOracleSubmission(depositId)
      await tellor.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43300)//12 hours
      const blockNumBefore = await ethers.provider.getBlockNumber();
      let b = await h.getBlock()
      await charon.oracleDeposit([1],0);
      //deposit from 2 to 3
      await token2.mint(accounts[1].address,web3.utils.toWei("100"))
      _amount = await charon2.calcInGivenOut(web3.utils.toWei("110"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token2.connect(accounts[1]).approve(charon2.address,_amount)
      let aliceDepositUtxo23 = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 3 })
      inputData = await prepareTransaction({
        charon: charon2,
        inputs:[],
        outputs: [aliceDepositUtxo23],
        account: {
          owner: accounts[0].address,
          publicKey: aliceDepositUtxo23.keypair.address(),
        },
        privateChainID: 3,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      args = inputData.args
      extData = inputData.extData
      await charon2.connect(accounts[1]).depositToOtherChain(args,extData,false);
      dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      ['bytes','uint256','bytes32'],
      [args.proof,args.publicAmount,args.root]
      );
      depositId = await charon2.getDepositIdByCommitmentHash(h.hash(dataEncoded))
      tellorData = await getTellorData(tellor3,charon2.address,2,depositId) 
      commi = await getTellorSubmission(args,extData);
      await tellor3.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43300)//12 hours
      tx = await charon3.oracleDeposit([2],1);  
      //deposit from 3 to 2
      await token3.mint(accounts[1].address,web3.utils.toWei("100"))
      _amount = await charon3.calcInGivenOut(web3.utils.toWei("100"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token3.connect(accounts[1]).approve(charon3.address,_amount)
      let aliceDepositUtxo32 = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 2 })
      inputData = await prepareTransaction({
        charon: charon3,
        inputs:[],
        outputs: [aliceDepositUtxo32],
        account: {
          owner: accounts[0].address,
          publicKey: aliceDepositUtxo32.keypair.address(),
        },
        privateChainID: 2,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      args = inputData.args
      extData = inputData.extData
      await charon3.connect(accounts[1]).depositToOtherChain(args,extData,false);
      dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      ['bytes','uint256','bytes32'],
      [args.proof,args.publicAmount,args.root]
      );
      depositId = await charon3.getDepositIdByCommitmentHash(h.hash(dataEncoded))
      tellorData = await getTellorData(tellor2,charon3.address,3,depositId) 
      commi = await getTellorSubmission(args,extData);
      await tellor2.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43200)//12 hours
      tx = await charon2.oracleDeposit([1],1);  
      //deposit from 3 to 1
      await token3.mint(accounts[1].address,web3.utils.toWei("100"))
      _amount = await charon.calcInGivenOut(web3.utils.toWei("110"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token3.connect(accounts[1]).approve(charon3.address,_amount)
      aliceDepositUtxo31 = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 1})
      inputData = await prepareTransaction({
        charon: charon3,
        inputs:[],
        outputs: [aliceDepositUtxo31],
        account: {
          owner: accounts[0].address,
          publicKey: aliceDepositUtxo31.keypair.address(),
        },
        privateChainID: 1,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      args = inputData.args
      extData = inputData.extData
      await charon3.connect(accounts[1]).depositToOtherChain(args,extData,false);
      dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      ['bytes','uint256','bytes32'],
      [args.proof,args.publicAmount,args.root]
      );
      depositId = await charon3.getDepositIdByCommitmentHash(h.hash(dataEncoded))
      tellorData = await getTellorData(tellor,charon3.address,3,depositId)
      commi = await getTellorSubmission(args,extData);
      await tellor.submitValue(tellorData.queryId,commi,tellorData.nonce,tellorData.queryData)
      await h.advanceTime(43300)//12 hours
      await charon.oracleDeposit([2],1);  
      //do a swap
      await token.mint(accounts[2].address,web3.utils.toWei("100"))
      let _minOut = await charon.calcOutGivenIn(web3.utils.toWei("120"),web3.utils.toWei("1000"),web3.utils.toWei("10"),0)
      let _maxPrice = await charon.calcSpotPrice(web3.utils.toWei("130"),web3.utils.toWei("900"),0)
      await token.connect(accounts[2]).approve(charon.address,web3.utils.toWei("10"))
      await charon.connect(accounts[2]).swap(false,web3.utils.toWei("10"), _minOut,_maxPrice)
      await token2.mint(accounts[1].address,web3.utils.toWei("100"))
      _minOut = await charon2.calcOutGivenIn(web3.utils.toWei("120"),web3.utils.toWei("1000"),web3.utils.toWei("10"),0)
      _maxPrice = await charon2.calcSpotPrice(web3.utils.toWei("130"),web3.utils.toWei("900"),0)
      await token2.connect(accounts[1]).approve(charon2.address,web3.utils.toWei("10"))
      await charon2.connect(accounts[1]).swap(false,web3.utils.toWei("10"), _minOut,_maxPrice)
      await chd3.mint(accounts[1].address,web3.utils.toWei("100"))
      _minOut = await charon3.calcOutGivenIn(web3.utils.toWei("1010"),web3.utils.toWei("102"),web3.utils.toWei("10"),0)
      _maxPrice = await charon3.calcSpotPrice(web3.utils.toWei("1010"),web3.utils.toWei("102"),0)
      await chd3.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("10"))
      await charon3.connect(accounts[1]).swap(true,web3.utils.toWei("10"), _minOut,_maxPrice)//this one with chdt
      //lp withdraw
      await charon.lpWithdraw(web3.utils.toWei("5"), 0,0)
      await charon2.lpWithdraw(web3.utils.toWei("5"), 0,0)
      await charon3.lpWithdraw(web3.utils.toWei("5"), 0,0)
      //transact on each chain
      let bobSendAmount = utils.parseEther('4')
      let  bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
      let bobAddress = await bobKeypair.address() // contains only public key
      let bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(bobAddress,poseidon), chainID: 2 })
      let aliceChangeUtxo = new Utxo({
          amount: _depositAmount.sub(bobSendAmount),
          myHashFunc: poseidon,
          keypair: aliceDepositUtxo12.keypair,
          chainID: 2
      })
     inputData = await prepareTransaction({
      charon: charon2,
      inputs:[aliceDepositUtxo12],
      outputs: [bobSendUtxo, aliceChangeUtxo],
      privateChainID: 2,
      myHasherFunc: poseidon,
      myHasherFunc2: poseidon2
    })
    args = inputData.args
    extData = inputData.extData

    assert(await charon2.isKnownRoot(inputData.args.root));
    await charon2.transact(args,extData)
    bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
    bobAddress = await bobKeypair.address() // contains only public key
    bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(bobAddress,poseidon), chainID: 1 })
    aliceChangeUtxo = new Utxo({
        amount: _depositAmount.sub(bobSendAmount),
        myHashFunc: poseidon,
        keypair: aliceDepositUtxo21.keypair,
        chainID: 1
    })
    inputData = await prepareTransaction({
        charon: charon,
        inputs:[aliceDepositUtxo21],
        outputs: [bobSendUtxo, aliceChangeUtxo],
        privateChainID: 1,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      args = inputData.args
      extData = inputData.extData
    
      assert(await charon.isKnownRoot(inputData.args.root));
      await charon.transact(args,extData)
      bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
      // contains private and public keys
      bobAddress = await bobKeypair.address() // contains only public key
      bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(bobAddress,poseidon), chainID: 3 })
      aliceChangeUtxo = new Utxo({
          amount: _depositAmount.sub(bobSendAmount),
          myHashFunc: poseidon,
          keypair: aliceDepositUtxo13.keypair,
          chainID: 3
      })
     inputData = await prepareTransaction({
         charon: charon3,
         inputs:[aliceDepositUtxo13],
         outputs: [bobSendUtxo, aliceChangeUtxo],
         privateChainID: 3,
         myHasherFunc: poseidon,
         myHasherFunc2: poseidon2
       })
      args = inputData.args
      extData = inputData.extData
      assert(await charon3.isKnownRoot(inputData.args.root));
      await charon3.transact(args,extData)
      //do another swap
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      _minOut = await charon.calcOutGivenIn(web3.utils.toWei("123"),web3.utils.toWei("800"),web3.utils.toWei("10"),0)
      _maxPrice = await charon.calcSpotPrice(web3.utils.toWei("123"),web3.utils.toWei("800"),0)
      await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
      await charon.connect(accounts[1]).swap(false,web3.utils.toWei("10"), _minOut,_maxPrice)
      await chd2.mint(accounts[1].address,web3.utils.toWei("100"))
      _minOut = await charon2.calcOutGivenIn(web3.utils.toWei("876"),web3.utils.toWei("104"),web3.utils.toWei("10"),0)
      _maxPrice = await charon2.calcSpotPrice(web3.utils.toWei("876"),web3.utils.toWei("104"),0)
      await chd2.connect(accounts[1]).approve(charon2.address,web3.utils.toWei("10"))
      await charon2.connect(accounts[1]).swap(true,web3.utils.toWei("10"), _minOut,_maxPrice)
      await chd3.mint(accounts[1].address,web3.utils.toWei("100"))
      _minOut = await charon3.calcOutGivenIn(web3.utils.toWei("960"),web3.utils.toWei("93"),web3.utils.toWei("10"),0)
      _maxPrice = await charon3.calcSpotPrice(web3.utils.toWei("960"),web3.utils.toWei("93"),0)
      await chd3.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("10"))
      await charon3.connect(accounts[1]).swap(true,web3.utils.toWei("10"), _minOut,_maxPrice)//this one with chd
      //withdraw on each chain/
      inputData = await prepareTransaction({
                    charon: charon,
                    inputs: [aliceDepositUtxo31],
                    outputs: [],
                    recipient: accounts[5].address,
                    privateChainID: 1,
                    myHasherFunc: poseidon,
                    myHasherFunc2: poseidon2
                })
                await charon.transact(inputData.args,inputData.extData)
                assert(await chd.balanceOf(accounts[5].address) - _depositAmount == 0, "should mint CHD");
            inputData = await prepareTransaction({
              charon: charon2,
              inputs: [aliceDepositUtxo32],
              outputs: [],
              recipient: accounts[5].address,
              privateChainID: 2,
              myHasherFunc: poseidon,
              myHasherFunc2: poseidon2
          })
          await charon2.transact(inputData.args,inputData.extData)
          assert(await chd2.balanceOf(accounts[5].address) - _depositAmount == 0, "should mint CHD");
                      inputData = await prepareTransaction({
                        charon: charon3,
                        inputs: [aliceChangeUtxo],
                        outputs: [],
                        recipient: accounts[5].address,
                        privateChainID: 3,
                        myHasherFunc: poseidon,
                        myHasherFunc2: poseidon2
                    })
                    await charon3.transact(inputData.args,inputData.extData)
                    assert(await chd3.balanceOf(accounts[5].address) - (_depositAmount - bobSendAmount) == 0, "should mint CHD");
      //LP extra on all 3
      await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
      let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
          web3.utils.toWei("100"),//poolSupply
          web3.utils.toWei("10")//tokenamountIn
          )
      await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      await charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
      await token2.connect(accounts[1]).approve(charon2.address,web3.utils.toWei("10"))
      minOut = await charon2.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
          web3.utils.toWei("100"),//poolSupply
          web3.utils.toWei("10")//tokenamountIn
          )
      await chd2.connect(accounts[1]).approve(charon2.address,web3.utils.toWei("100"))
      await charon2.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
      await token3.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("10"))
      minOut = await charon3.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
          web3.utils.toWei("100"),//poolSupply
          web3.utils.toWei("10")//tokenamountIn
          )
      await chd3.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("100"))
      await charon3.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
      //do another swap
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      _minOut = await charon.calcOutGivenIn(web3.utils.toWei("133"),web3.utils.toWei("760"),web3.utils.toWei("10"),0)
      _maxPrice = await charon.calcSpotPrice(web3.utils.toWei("133"),web3.utils.toWei("760"),0)
      await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
      await charon.connect(accounts[1]).swap(false,web3.utils.toWei("10"), _minOut,_maxPrice)
      await token2.mint(accounts[1].address,web3.utils.toWei("100"))
     _minOut = await charon2.calcOutGivenIn(web3.utils.toWei("121"),web3.utils.toWei("810"),web3.utils.toWei("10"),0)
      _maxPrice = await charon2.calcSpotPrice(web3.utils.toWei("121"),web3.utils.toWei("810"),0)
      await token2.connect(accounts[1]).approve(charon2.address,web3.utils.toWei("10"))
      await charon2.connect(accounts[1]).swap(false,web3.utils.toWei("10"), _minOut,_maxPrice)
      _minOut = await charon3.calcOutGivenIn(web3.utils.toWei("1000"),web3.utils.toWei("89"),web3.utils.toWei("10"),0)
      _maxPrice = await charon3.calcSpotPrice(web3.utils.toWei("1000"),web3.utils.toWei("89"),0)
      await chd3.connect(accounts[1]).approve(charon3.address,web3.utils.toWei("10"))
      await charon3.connect(accounts[1]).swap(true,web3.utils.toWei("10"), _minOut,_maxPrice)//this one with chd
    })
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
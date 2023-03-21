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
      ['bytes32','bytes32','bytes32','bytes32','bytes','bytes','bytes'],
      [
        args.inputNullifiers[0],
        args.inputNullifiers[1],
        args.outputCommitments[0],
        args.outputCommitments[1],
        args.proof,
        extData.encryptedOutput1,
        extData.encryptedOutput2
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
    let verifier2,verifier16,token,charon,hasher,token2,charon2,mockNative ,mockNative2, cfc,cfc2, tellorBridge, tellorBridge2, e2p, p2e;
    let fee = 0;
    let HEIGHT = 23;
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
        mockNative = await deploy("MockNativeBridge")
        mockNative2 = await deploy("MockNativeBridge")
        tellorBridge = await deploy("TellorBridge", tellor.address)
        tellorBridge2 = await deploy("TellorBridge", tellor2.address)
        p2e = await deploy("MockPOLtoETHBridge", tellor2.address, mockNative2.address)
        e2p = await deploy("MockETHtoPOLBridge", tellor.address,mockNative.address, mockNative.address)
        await e2p.setFxChildTunnel(mockNative.address)
        await mockNative.setUsers(tellorBridge.address, p2e.address, e2p.address)
        await mockNative2.setUsers(tellorBridge2.address, p2e.address, e2p.address)
        charon = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token.address,fee,[e2p.address,tellorBridge.address],HEIGHT,1,"Charon Pool Token","CPT")
        //now deploy on other chain (same chain, but we pretend w/ oracles)
        token2 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        charon2 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,[p2e.address],HEIGHT,2,"Charon Pool Token2","CPT2");
        await tellorBridge2.setPartnerInfo(charon.address,1);
        chd = await deploy("MockERC20",charon.address,"charon dollar","chd")
        chd2 = await deploy("MockERC20",charon2.address,"charon dollar2","chd2")
        //now set both of them. s
        await p2e.setCharon(charon2.address);
        await e2p.setCharon(charon.address);
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      await h.expectThrow(charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount))
      let stateId = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      await charon2.oracleDeposit([0],_id);
      await h.expectThrow(charon2.oracleDeposit([0],_id))
      await token.connect(accounts[1]).approve(charon.address,_amount)
      charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount)
    })
    it("deposit same commitment on both chains", async function() {
      let mockNative3 = await deploy("MockNativeBridge")
      await mockNative3.setUsers(tellorBridge2.address, p2e.address, e2p.address)
      let token3 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
      await token3.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
      let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor3 = await TellorOracle.deploy();
        tellorBridge3 = await deploy("TellorBridge", tellor3.address)
      let charon3 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token3.address,fee,[tellorBridge3.address],HEIGHT,3,"Charon Pool Token2","CPT2");
      let chd3 = await deploy("MockERC20",charon3.address,"charon dollar3","chd3") 
      await tellorBridge3.setPartnerInfo(charon.address,1)
      await chd3.deployed();
      await token3.approve(charon3.address,web3.utils.toWei("100"))
      cfc3 = await deploy('MockCFC',token3.address,chd3.address)
      await cfc3.deployed();
      await charon3.finalize([1,2],[charon.address,charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address, cfc3.address);
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      let stateId = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      const fromBlock = await ethers.provider.getBlock()
      await charon2.oracleDeposit([0],_id);
      let depositId = 1
      let _query = await getTellorData(tellor3,charon.address,1,depositId);
      let _value = await charon.getOracleSubmission(depositId);
      await tellor3.submitValue(_query.queryId, _value,_query.nonce, _query.queryData);
      await h.advanceTime(86400)//wait 12 hours
      _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
      await charon3.oracleDeposit([0],_encoded);
      const filter = charon2.filters.NewCommitment()
      const events = await charon2.queryFilter(filter, fromBlock.number)
      let aReceiveUtxo
      try {
          aReceiveUtxo = Utxo.decrypt(aliceDepositUtxo.keypair, events[0].args._encryptedOutput, events[0].args._index)
      } catch (e) {
        // we try to decrypt another output here because it shuffles outputs before sending to blockchain
          aReceiveUtxo = Utxo.decrypt(aliceDepositUtxo.keypair, events[1].args._encryptedOutput, events[1].args._index)
      }
      expect(aReceiveUtxo.amount).to.be.equal(_depositAmount)
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
    await h.expectThrow(charon3.transact(inputData.args,inputData.extData))  
    try{
      inputData = await prepareTransaction({
        charon: charon3,
        inputs: [aliceDepositUtxo],
        outputs: [],
        recipient: accounts[1].address,
        privateChainID: 3,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
    })
    } catch{
      console.log("good throw")
    }
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
      //bad bridge
      let _data = await getTellorSubmission(args,extData)
      await mockNative2.sendMessageToChild(mockNative2.address,_data)
      let stateId = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      await charon2.oracleDeposit([0],_id);
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,web3.utils.toWei("100"));//actually run it
      _data = await getTellorSubmission(args,extData)
      await mockNative2.sendMessageToChild(mockNative2.address,_data)
      stateId = await p2e.latestStateId();
      _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      await h.expectThrow(charon2.oracleDeposit([0],_id)); //can't now deposit it if it actually goes through
      //same input twice, even if you just deposited it once, its the same input. 
      //So that should give some comfort (if you the chain isn't finalized or something, i don't know)
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
            await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
            let stateId = await p2e.latestStateId();
            let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
            await charon2.oracleDeposit([0],_id);
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
            await charon2.lpWithdraw(web3.utils.toWei("100"), web3.utils.toWei("999"),web3.utils.toWei("99"))
            assert(web3.utils.toWei("1000000") - await token2.balanceOf(accounts[0].address)*1 <web3.utils.toWei(".01"), "should withdraw all tokens")
            assert(web3.utils.toWei("1000") - 1*await chd2.balanceOf(accounts[0].address)*1  < web3.utils.toWei(".01") , "should withdraw all chd")
            assert(await charon2.totalSupply() == 0, "all pool tokens should be gone")
    })
    it("underlying token freezes (tellor upgrade example), deposit back to other side to withdraw", async function() {
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
            await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
            let stateId = await p2e.latestStateId();
            let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
            await charon2.oracleDeposit([0],_id);
            // Alice sends some funds to withdraw (ignore bob)
            let bobSendAmount = utils.parseEther('4')
            const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
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
            const filter = charon2.filters.NewCommitment()
            const fromBlock = await ethers.provider.getBlock()
            const events = await charon2.queryFilter(filter, fromBlock.number)
            let bobReceiveUtxo;
            try {
                bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args._encryptedOutput, events[0].args._index)
            } catch (e) {
            // we try to decrypt another output here because it shuffles outputs before sending to blockchain
                bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args._encryptedOutput, events[1].args._index)
            }
            expect(bobReceiveUtxo.amount).to.be.equal(web3.utils.toWei("4"))
            inputData = await prepareTransaction({
              charon: charon2,
              inputs: [aliceChangeUtxo],
              outputs: [],
              recipient: accounts[1].address,
              privateChainID: 2,
              myHasherFunc: poseidon,
              myHasherFunc2: poseidon2
          })
          await charon2.transact(inputData.args,inputData.extData)
          assert(await chd2.balanceOf(accounts[1].address) == web3.utils.toWei("6"))

          await chd2.connect(accounts[1]).approve(charon.address,web3.utils.toWei("6"))
          aliceNewUtxo = new Utxo({ amount: web3.utils.toWei("6"), myHashFunc: poseidon, chainID: 1 })
          charon = charon.connect(sender)
          inputData = await prepareTransaction({
            charon,
            inputs:[],
            outputs: [aliceNewUtxo],
            account: {
              owner: accounts[1].address,
              publicKey: aliceNewUtxo.keypair.address(),
            },
            privateChainID: 1,
            myHasherFunc: poseidon,
            myHasherFunc2: poseidon2
          })
          await charon2.connect(accounts[1]).depositToOtherChain(inputData.args,inputData.extData,true, web3.utils.toWei("6"));
          commi = await getTellorSubmission(inputData.args,inputData.extData);
          await charon.oracleDeposit([0],commi);
        //let bobActualUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair, chainID: 1 })
        bobReceiveUtxo.chainID = 2
        inputData = await prepareTransaction({
          charon: charon2,
          inputs: [bobReceiveUtxo],
          outputs: [],
          recipient: accounts[2].address,
          privateChainID: 2,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
      })

        await charon2.transact(inputData.args,inputData.extData)
        assert(await chd2.balanceOf(accounts[2].address) == web3.utils.toWei("4"))
        await chd2.connect(accounts[2]).approve(charon2.address,web3.utils.toWei("4"))
        const bobDepositUtxo = new Utxo({ amount: web3.utils.toWei("4"), myHashFunc: poseidon, chainID: 1 })
        charon = charon.connect(sender)
        inputData = await prepareTransaction({
          charon,
          inputs:[],
          outputs: [bobDepositUtxo],
          account: {
            owner: bobKeypair.address(),
            publicKey: bobDepositUtxo.keypair.address(),
          },
          privateChainID: 1,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
        })
        await charon2.connect(accounts[2]).depositToOtherChain(inputData.args,inputData.extData,true,0);
        commi = await getTellorSubmission(inputData.args,inputData.extData);
        await charon.oracleDeposit([0],commi);
        inputData = await prepareTransaction({
          charon: charon,
          inputs: [bobDepositUtxo],
          outputs: [],
          recipient: accounts[2].address,
          privateChainID: 1,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
      })
      await charon.transact(inputData.args,inputData.extData)
      assert(chd.balanceOf(accounts[2].address == web3.utils.toWei("4")))

    })
    it("Multiple back and forths (oracle deposits on 3 different chains and withdrawals and trades)", async function() {
      console.log("starting long e2e test....")
      //start 3 systems
      let mockNative3 = await deploy("MockNativeBridge")
      await mockNative3.setUsers(tellorBridge2.address, p2e.address, e2p.address)
      let token3 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
      await token3.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
      let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor3 = await TellorOracle.deploy();
        tellorBridge3 = await deploy("TellorBridge", tellor3.address)
      let charon3 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token3.address,fee,[tellorBridge3.address],HEIGHT,3,"Charon Pool Token2","CPT2");
      let chd3 = await deploy("MockERC20",charon3.address,"charon dollar3","chd3") 
      await tellorBridge.setPartnerInfo(charon3.address, 3);
      await tellorBridge3.setPartnerInfo(charon.address,1)
      await chd3.deployed();
      await token3.approve(charon3.address,web3.utils.toWei("100"))
      cfc3 = await deploy('MockCFC',token3.address,chd3.address)
      await cfc3.deployed();
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      let stateId = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      await charon2.oracleDeposit([0],_id);
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
        ['bytes','uint256','bytes32'],
        [args.proof,args.publicAmount,args.root]
        );
        let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
        let _query = await getTellorData(tellor3,charon.address,1,depositId);
        let _value = await charon.getOracleSubmission(depositId);
        await tellor3.submitValue(_query.queryId, _value,_query.nonce, _query.queryData);
        await tellor3.submitValue(_query.queryId, _value,_query.nonce, _query.queryData);//twice for funsies (shouldn't care)
        await h.advanceTime(86400)//wait 12 hours
        _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
        await charon3.oracleDeposit([0],_encoded);
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
      await charon2.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      commi = await getTellorSubmission(args,extData);
      await charon.oracleDeposit([0],commi);
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
      await charon3.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      let __dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
        ['bytes','uint256','bytes32'],
        [args.proof,args.publicAmount,args.root]
      );
      depositId = await charon3.getDepositIdByCommitmentHash(h.hash(__dataEncoded))
      _query = await getTellorData(tellor,charon3.address,3,depositId);
      _value = await charon3.getOracleSubmission(depositId);
      await tellor.submitValue(_query.queryId, _value,_query.nonce, _query.queryData);
      await h.advanceTime(86400)//wait 12 hours
      _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
      await charon.oracleDeposit([1],_encoded);
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
      _maxPrice = await charon3.calcSpotPrice(web3.utils.toWei("1020"),web3.utils.toWei("101"),0)
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      let stateId = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      await charon2.oracleDeposit([0],_id); 
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
        oldInputData = await prepareTransaction({
          charon: charon2,
          inputs: [aliceDepositUtxo],
          outputs: [],
          recipient: accounts[1].address,
          privateChainID: 1,
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2,
          test:true
      })
      await h.expectThrow(charon2.transact(oldInputData.args,oldInputData.extData))//wrongt chain
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      let stateId = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      await charon2.oracleDeposit([0],_id);
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
      fakeInputData = await prepareTransaction({
        charon: charon,
        inputs: [aliceDepositUtxo],
        outputs: [],
        recipient: accounts[1].address,
        privateChainID: 2,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2,
        test: true
      })
      await h.expectThrow(charon2.transact(fakeInputData.args,fakeInputData.extData))//wrongCharon
      await charon2.transact(inputData.args,inputData.extData)
      await h.expectThrow(charon2.transact(inputData.args,inputData.extData))
      assert(await chd2.balanceOf(accounts[1].address) - _depositAmount == 0, "should mint CHD");
    })
    it("test rebate", async function() {
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
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,web3.utils.toWei("9999"));
      let stateId1 = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId1]);
      await charon2.oracleDeposit([0],_id);
      //alice withdraws
      inputData = await prepareTransaction({
        charon: charon2,
        inputs: [aliceDepositUtxo],
        outputs: [],
        recipient: accounts[3].address,
        privateChainID: 2,
        fee: web3.utils.toWei("2"),
        rebate: web3.utils.toWei("5"),
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
    })
    await h.expectThrow(charon2.connect(accounts[2]).transact(inputData.args,inputData.extData))//rebate too big
      inputData = await prepareTransaction({
          charon: charon2,
          inputs: [aliceDepositUtxo],
          outputs: [],
          recipient: accounts[3].address,
          relayer: accounts[2].address,
          privateChainID: 2,
          fee: web3.utils.toWei("2"),
          rebate: web3.utils.toWei("1"),
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
      })
      let _rebate = await charon2.calcOutGivenIn(web3.utils.toWei("1000"),web3.utils.toWei("100"),web3.utils.toWei("1"),0);
      let balAcc3 = await ethers.provider.getBalance(accounts[3].address)
      let chdBal2 = await chd2.balanceOf(accounts[2].address); 
      await charon2.connect(accounts[2]).transact(inputData.args,inputData.extData,{value:_rebate})
      assert(await chd2.balanceOf(accounts[3].address)- (_depositAmount- web3.utils.toWei("2")) == 0, "should mint CHD");
      assert(await chd2.balanceOf(accounts[2].address) - chdBal2 ==  web3.utils.toWei("2"), "should mint CHD to relayer");
      assert(Math.abs(await ethers.provider.getBalance(accounts[3].address) - balAcc3 - _rebate) < web3.utils.toWei(".01"), "rebate should be given" )
      await chd2.connect(accounts[3]).transfer(accounts[1].address, web3.utils.toWei("2"))
    })
    it("Attempt to swap out of massive position", async function() {
      //try to do more than in the pool, assert fail
      await token.mint(accounts[1].address,web3.utils.toWei("1000"))
      await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("1000"))
      await h.expectThrow(charon.connect(accounts[1]).swap(false,web3.utils.toWei("1000"),0,web3.utils.toWei("50000")))
      await h.expectThrow(charon.connect(accounts[1]).swap(false,web3.utils.toWei("20"),0,web3.utils.toWei(".1")))//badPrice
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
      await charon.connect(accounts[1]).addRewards(web3.utils.toWei("1000"),web3.utils.toWei("1000"),web3.utils.toWei("1000"),true)
      await charon.connect(accounts[1]).addRewards(web3.utils.toWei("1000"),web3.utils.toWei("1000"),web3.utils.toWei("1000"),false)
      await charon2.connect(accounts[1]).addRewards(web3.utils.toWei("1000"),web3.utils.toWei("1000"),web3.utils.toWei("1000"),true)
      await charon2.connect(accounts[1]).addRewards(web3.utils.toWei("1000"),web3.utils.toWei("1000"),web3.utils.toWei("1000"),false)
      assert(await charon.recordBalanceSynth() == web3.utils.toWei("2000"), "new recordBalance Synth should be correct")
      assert(await charon.recordBalance() == web3.utils.toWei("1100"), "new recordBalance should be correct")
      assert(await charon.oracleCHDFunds() == web3.utils.toWei("1000"), "new oracleCHD funds should be correct")
      assert(await charon.oracleTokenFunds() == web3.utils.toWei("1000"), "new oracleToken funds should be correct")
      assert(await charon.userRewardsCHD() == web3.utils.toWei("1000"), "new userRewardsCHD should be correct")
      assert(await charon.userRewards() == web3.utils.toWei("1000"), "new userRewards should be correct")

      //deposit twice and assert correct user rewards
      let _depositAmount = web3.utils.toWei("10");
      await token.mint(accounts[3].address,web3.utils.toWei("100"))
      let _amount = await charon.calcInGivenOut(web3.utils.toWei("1100"),
                                                web3.utils.toWei("2000"),
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
      await charon.connect(accounts[3]).depositToOtherChain(args,extData,false,_amount);
      let stateId1 = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId1]);
      await charon2.connect(accounts[5]).oracleDeposit([0],_id);
      let userW = web3.utils.toWei("1000")/1000   
      assert((await token.balanceOf(accounts[3].address)*1  + 1*_amount) - userW - web3.utils.toWei("100") == 0, "token balance should be correct")
      assert(await chd.balanceOf(accounts[3].address) - userW ==0, "chd balance should be correct")
      assert(await charon.userRewards() - (web3.utils.toWei("1000") - userW) == 0, "user rewards should properly subtract")
      assert(await charon.userRewardsCHD() - (web3.utils.toWei("1000") - userW) == 0, "user rewards chd should properly subtract")
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
      let _payamount = await charon.userRewards() / 1000
      await charon.connect(accounts[4]).depositToOtherChain(args2,extData2,false,_amount);
      assert((await token.balanceOf(accounts[4].address)*1  + 1*_amount)  - _payamount - web3.utils.toWei("100") == 0, "token balance should be correct2")
      assert(await chd.balanceOf(accounts[4].address) - _payamount < web3.utils.toWei("0.01"), "chd balance should be correct2")
      assert(await chd.balanceOf(accounts[4].address) - _payamount >= 0 , "chd balance should be correct2")
      assert(await charon.userRewards()  - (web3.utils.toWei("1000") - _payamount - userW) >= 0, "user rewards should properly subtract2")
      assert(await charon.userRewards()  - (web3.utils.toWei("1000") - _payamount - userW) < web3.utils.toWei(".001"), "user rewards should properly subtract2")
      assert(await charon.userRewardsCHD() - (web3.utils.toWei("1000") - _payamount - userW) >= 0, "user rewards chd should properly subtract2")
      assert(await charon.userRewardsCHD() - (web3.utils.toWei("1000") - _payamount - userW) < web3.utils.toWei(".001"), "user rewards chd should properly subtract2")
      //move both pieces of data over and assert correct oracle rewards
        let stateId = await p2e.latestStateId();
        _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
        await charon2.connect(accounts[6]).oracleDeposit([0],_id);
        assert(await token2.balanceOf(accounts[5].address) == web3.utils.toWei("1"), "token balance should be correct3")
        assert(await chd2.balanceOf(accounts[5].address) ==  web3.utils.toWei("1"), "chd balance should be correct2")
        assert(await token2.balanceOf(accounts[6].address) == web3.utils.toWei(".999"), "token balance should be correct2 - 2")
        assert(await chd2.balanceOf(accounts[6].address) == web3.utils.toWei(".999"), "chd balance should be correct2 -2")
        assert(await charon2.oracleTokenFunds() - (web3.utils.toWei("1000") - web3.utils.toWei(".999") - web3.utils.toWei("1")) >= 0, "user rewards should properly subtract2")
        assert(await charon2.oracleTokenFunds() - (web3.utils.toWei("1000") - web3.utils.toWei(".999") - web3.utils.toWei("1")) < web3.utils.toWei(".001"), "user rewards should properly subtract2")
        assert(await charon2.oracleCHDFunds() - (web3.utils.toWei("1000") - web3.utils.toWei(".999") - web3.utils.toWei("1")) >= 0, "user rewards should properly subtract2")
        assert(await charon2.oracleCHDFunds() - (web3.utils.toWei("1000") - web3.utils.toWei(".999") - web3.utils.toWei("1")) < web3.utils.toWei(".001"), "user rewards should properly subtract2")
    })
    it("Test distribution of base fee", async function() {
      fee = web3.utils.toWei(".02");//2%
      let charon3 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token.address,fee,[e2p.address],HEIGHT,1,"Charon Pool Token","CPT")
      let charon4 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token2.address,fee,[p2e.address],HEIGHT,2,"Charon Pool Token2","CPT2");
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
      bal1 = await chd4.balanceOf(accounts[1].address)
      await charon4.connect(accounts[1]).lpWithdraw(ptokens,0,0)
      bal2 = await chd4.balanceOf(accounts[1].address)
      assert(await chd4.balanceOf(cfc4.address)  > ((bal2-bal1)*.02 ) > 0, "chd should be correct after single lpWithdraw, no fee")
      assert(await chd4.balanceOf(cfc4.address)  > ((bal2-bal1)*.02 ) < web3.utils.toWei(".01"), "chd should be correct after single lpWithdraw, no fee")
    })
    it("deposit on own chain", async function() {
      let mockNative3 = await deploy("MockNativeBridge")
      await mockNative3.setUsers(tellorBridge2.address, p2e.address, e2p.address)
      let token3 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
      await token3.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
      let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor3 = await TellorOracle.deploy();
        tellorBridge3 = await deploy("TellorBridge", tellor3.address)
      let charon3 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token3.address,fee,[tellorBridge3.address],HEIGHT,3,"Charon Pool Token2","CPT2");
      let chd3 = await deploy("MockERC20",charon3.address,"charon dollar3","chd3") 
      await tellorBridge3.setPartnerInfo(charon.address,1)
      await chd3.deployed();
      await token3.approve(charon3.address,web3.utils.toWei("100"))
      cfc3 = await deploy('MockCFC',token3.address,chd3.address)
      await cfc3.deployed();
      await charon3.finalize([1,2],[charon.address,charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address, cfc3.address);
      let _depositAmount = web3.utils.toWei("10");
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token.connect(accounts[1]).approve(charon.address,_amount)
      const sender = accounts[0]
      const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc:poseidon, chainID: 1 })
      charon = charon.connect(sender)
      let inputData = await prepareTransaction({
        charon,
        inputs:[],
        outputs: [aliceDepositUtxo],
        account: {
          owner: sender.address,
          publicKey: aliceDepositUtxo.keypair.address(),
        },
        privateChainID: 1,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      let args = inputData.args
      let extData = inputData.extData
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      let stateId = await p2e.latestStateId();
      let _id = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[stateId]);
      await charon2.oracleDeposit([0],_id);
      let depositId = 1
      let _query = await getTellorData(tellor3,charon.address,1,depositId);
      let _value = await charon.getOracleSubmission(depositId);
      await tellor3.submitValue(_query.queryId, _value,_query.nonce, _query.queryData);
      await h.advanceTime(86400)//wait 12 hours
      _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
      await charon3.oracleDeposit([0],_encoded);
      inputData = await prepareTransaction({
        charon: charon,
        inputs: [aliceDepositUtxo],
        outputs: [],
        recipient: accounts[1].address,
        privateChainID: 1,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
    })
    await h.expectThrow(charon2.transact(inputData.args,inputData.extData))  
    await charon.transact(inputData.args,inputData.extData)
    await h.expectThrow(charon3.transact(inputData.args,inputData.extData))  
    try{
      inputData = await prepareTransaction({
        charon: charon3,
        inputs: [aliceDepositUtxo],
        outputs: [],
        recipient: accounts[1].address,
        privateChainID: 3,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
    })
    } catch{
      console.log("good throw")
    }
    })
    it("test relayer payment on secret transfer", async function() {
      let mockNative3 = await deploy("MockNativeBridge")
      await mockNative3.setUsers(tellorBridge2.address, p2e.address, e2p.address)
      let token3 = await deploy("MockERC20",accounts[1].address,"Dissapearing Space Monkey2","DSM2")
      await token3.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
      let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor3 = await TellorOracle.deploy();
        tellorBridge3 = await deploy("TellorBridge", tellor3.address)
      let charon3 = await deploy("Charon",verifier2.address,verifier16.address,hasher.address,token3.address,fee,[tellorBridge3.address],HEIGHT,3,"Charon Pool Token2","CPT2");
      let chd3 = await deploy("MockERC20",charon3.address,"charon dollar3","chd3") 
      await tellorBridge3.setPartnerInfo(charon.address,1)
      await chd3.deployed();
      await token3.approve(charon3.address,web3.utils.toWei("100"))
      cfc3 = await deploy('MockCFC',token3.address,chd3.address)
      await cfc3.deployed();
      await charon3.finalize([1,2],[charon.address,charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address, cfc3.address);
      let _depositAmount = web3.utils.toWei("10");
      await token.mint(accounts[1].address,web3.utils.toWei("100"))
      let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                web3.utils.toWei("1000"),
                                                _depositAmount,
                                                0)
      await token.connect(accounts[1]).approve(charon.address,_amount)
      const sender = accounts[0]
      const aliceDepositUtxo = new Utxo({ amount: _depositAmount, myHashFunc:poseidon, chainID: 1 })
      charon = charon.connect(sender)
      let inputData = await prepareTransaction({
        charon,
        inputs:[],
        outputs: [aliceDepositUtxo],
        account: {
          owner: sender.address,
          publicKey: aliceDepositUtxo.keypair.address(),
        },
        privateChainID: 1,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      let args = inputData.args
      let extData = inputData.extData
      await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,_amount);
      // Alice sends some funds to withdraw (ignore bob)
      let bobSendAmount = utils.parseEther('4')
      const bobKeypair = new Keypair({myHashFunc:poseidon}) // contains private and public keys
// contains private and public keys
      const bobAddress = await bobKeypair.address() // contains only public key
      const bobSendUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: Keypair.fromString(bobAddress,poseidon), chainID: 1 })
      
      let aliceChangeUtxo = new Utxo({
          amount: web3.utils.toWei('3'),//3 = 10-4(toBob)-3fee
          myHashFunc: poseidon,
          keypair: aliceDepositUtxo.keypair,
          chainID: 1
      })
      inputData = await prepareTransaction({
          charon: charon,
          inputs:[aliceDepositUtxo],
          outputs: [bobSendUtxo, aliceChangeUtxo],
          privateChainID: 1,
          fee: web3.utils.toWei("3"),
          myHasherFunc: poseidon,
          myHasherFunc2: poseidon2
        })
    await charon.connect(accounts[3]).transact(inputData.args,inputData.extData)
    assert(await chd.balanceOf(accounts[3].address) == web3.utils.toWei("3"))
    const filter = charon.filters.NewCommitment()
    const fromBlock = await ethers.provider.getBlock()
    const events = await charon.queryFilter(filter, fromBlock.number)
    let receiveUtxo
    try {
      receiveUtxo = Utxo.decrypt(aliceDepositUtxo.keypair, events[0].args._encryptedOutput, events[0].args._index)
    } catch (e) {
    // we try to decrypt another output here because it shuffles outputs before sending to blockchain
        receiveUtxo = Utxo.decrypt(aliceDepositUtxo.keypair, events[1].args._encryptedOutput, events[1].args._index)
    }
    expect(receiveUtxo.amount).to.be.equal(web3.utils.toWei("3"))

    let bobReceiveUtxo;
    try {
        bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args._encryptedOutput, events[0].args._index)
    } catch (e) {
    // we try to decrypt another output here because it shuffles outputs before sending to blockchain
        bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args._encryptedOutput, events[1].args._index)
    }
    expect(bobReceiveUtxo.amount).to.be.equal(web3.utils.toWei("4"))
    // have bob and alice try and pull out more than they can
    try{
      let aliceFakeUtxo = new Utxo({
        amount: web3.utils.toWei('6'),//amount w/out fee
        myHashFunc: poseidon,
        keypair: aliceDepositUtxo.keypair,
        chainID: 1
        
      })
      inputData = await prepareTransaction({
        charon: charon,
        inputs: [aliceFakeUtxo],
        outputs: [],
        recipient: accounts[1].address,
        privateChainID: 1,
        myHasherFunc: poseidon,
        myHasherFunc2: poseidon2
      })
      await charon.transact(inputData.args,inputData.extData)
    }
    catch{
      console.log("good fake catch on passing no fee")
    }
    //alice actually pulls out 
    inputData = await prepareTransaction({
      charon: charon,
      inputs: [aliceChangeUtxo],
      outputs: [],
      recipient: accounts[4].address,
      privateChainID: 1,
      myHasherFunc: poseidon,
      myHasherFunc2: poseidon2
  })
  await charon.transact(inputData.args,inputData.extData)
  assert(await chd.balanceOf(accounts[4].address) - web3.utils.toWei("3") == 0, "should mint CHD to Alice");

  //bob pulls out (heyo)
  //let bobActualUtxo = new Utxo({ amount: bobSendAmount,myHashFunc: poseidon, keypair: bobKeypair, chainID: 1 })
  bobReceiveUtxo.chainID = 1
  inputData = await prepareTransaction({
    charon: charon,
    inputs: [bobReceiveUtxo],
    outputs: [],
    recipient: accounts[5].address,
    privateChainID: 1,
    myHasherFunc: poseidon,
    myHasherFunc2: poseidon2
})
await charon.transact(inputData.args,inputData.extData)
assert(await chd.balanceOf(accounts[5].address) - web3.utils.toWei("4") == 0, "should mint CHD to Bob");
    })
    it("test all checkDrip functions and working properly -- cannot transfer, transferFrom, LPWithdraw for one day", async function() {
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
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1000") == 0, "record balancesynth should be correct")
      assert(await charon.dripRate() == web3.utils.toWei(".01"), "drip rate should be correct")
      assert(await charon.singleCHDLPToDrip() == web3.utils.toWei("10"))
      await h.expectThrow(charon.connect(accounts[1]).transfer(accounts[3].address, web3.utils.toWei(".1")))
      await charon.connect(accounts[1]).approve(accounts[2].address, web3.utils.toWei("100"))
      await h.expectThrow(charon.connect(accounts[2]).transferFrom(accounts[1].address, accounts[3].address,web3.utils.toWei(".1")))
      await h.expectThrow(charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei(".1"), 0,0))
      h.advanceTime(86400)
      //fast forward a day, all three functions work
      await charon.connect(accounts[1]).transfer(accounts[3].address, web3.utils.toWei(".1"))
      await charon.connect(accounts[2]).transferFrom(accounts[1].address, accounts[3].address,web3.utils.toWei(".1"))
      await charon.checkDrip()
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1000.01") == 0, "record balancesynth should go up 1")
      await charon.checkDrip();
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1000.02") == 0, "record balancesynth should go up 2")
      await chd.mint(accounts[3].address,web3.utils.toWei("1000"))
      await chd.connect(accounts[3]).approve(charon.address,web3.utils.toWei("150"))
      await charon.connect(accounts[3]).addRewards(web3.utils.toWei("5"),0,web3.utils.toWei("5"),true)//no toLP's
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1000.03") == 0, "record balancesynth should go up 3");
            //check all functions ( swap, transfer,)

      let _depositAmount = utils.parseEther('10');
            await token.mint(accounts[1].address,web3.utils.toWei("100"))
            let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                      web3.utils.toWei("1000"),
                                                      _depositAmount,
                                                      0)
            await token.connect(accounts[1]).approve(charon.address,_amount)
            const sender = accounts[0]
            const aliceDepositUtxo = new Utxo({ amount: _depositAmount,myHashFunc: poseidon, chainID: 1 })
            charon = charon.connect(sender)
            let inputData = await prepareTransaction({
              charon,
              inputs:[],
              outputs: [aliceDepositUtxo],
              account: {
                owner: sender.address,
                publicKey: aliceDepositUtxo.keypair.address(),
              },
              privateChainID: 1,
              myHasherFunc: poseidon,
              myHasherFunc2: poseidon2
            })
            let args = inputData.args
            let extData = inputData.extData
            await charon.connect(accounts[1]).depositToOtherChain(args,extData,false,web3.utils.toWei("9999"));
            assert(await charon.recordBalanceSynth() - web3.utils.toWei("1000.04") == 0, "record balancesynth should go up 4")
            //alice withdraws
            inputData = await prepareTransaction({
                charon: charon,
                inputs: [aliceDepositUtxo],
                outputs: [],
                recipient: accounts[1].address,
                privateChainID: 1,
                myHasherFunc: poseidon,
                myHasherFunc2: poseidon2
            })
            await charon.transact(inputData.args,inputData.extData)
            assert(await charon.recordBalanceSynth() - web3.utils.toWei("1000.05") == 0, "record balancesynth should go up 5")
            await token.mint(accounts[1].address,web3.utils.toWei("100"))
            await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
            let bal1 = await chd.balanceOf(accounts[1].address);
            let cfcBal1 = await chd.balanceOf(cfc.address);
            let rec1 = await charon.recordBalanceSynth();
            await charon.connect(accounts[1]).swap(false,web3.utils.toWei("10"),0,web3.utils.toWei("99999999"))
            let bal2 = await chd.balanceOf(accounts[1].address);
            let cfcBal2 = await chd.balanceOf(cfc.address);
            assert(Math.abs((rec1*1 + 1*web3.utils.toWei(".01")) - ((bal2-bal1) + (cfcBal2 - cfcBal1))- (await charon.recordBalanceSynth()*1)) < web3.utils.toWei(".001") , "record balancesynth should go up 6")
            await token.mint(accounts[1].address,web3.utils.toWei("100"))
            await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
            await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
            await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
            rec1 = await charon.recordBalanceSynth();
            bal1 = await chd.balanceOf(accounts[1].address);
            cfcBal1 = await chd.balanceOf(cfc.address);
            await charon.connect(accounts[1]).lpDeposit(web3.utils.toWei("1"),web3.utils.toWei("100"),web3.utils.toWei("10"))
            bal2 = await chd.balanceOf(accounts[1].address);
            cfcBal2 = await chd.balanceOf(cfc.address);
            assert(Math.abs((rec1*1 + 1*web3.utils.toWei(".01")) - ((bal2-bal1) + (cfcBal2 - cfcBal1))- (await charon.recordBalanceSynth()*1)) < web3.utils.toWei(".001") , "record balancesynth should go up 7")
            bal1 = await chd.balanceOf(accounts[1].address);
            cfcBal1 = await chd.balanceOf(cfc.address);
            rec1 = await charon.recordBalanceSynth();
            await charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei(".1"), 0,0);//can do since past a day
            bal2 = await chd.balanceOf(accounts[1].address);
            cfcBal2 = await chd.balanceOf(cfc.address);
            assert(Math.abs((rec1*1 + 1*web3.utils.toWei(".01")) - ((bal2-bal1) + (cfcBal2 - cfcBal1))- (await charon.recordBalanceSynth()*1)) < web3.utils.toWei(".001") , "record balancesynth should go up 8")
    })
    it("drain test drip -- multiple drips added, full drip", async function() {
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
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1000") == 0, "record balancesynth should be correct")
      assert(await charon.dripRate() == web3.utils.toWei(".01"), "drip rate should be correct")
      assert(await charon.singleCHDLPToDrip() == web3.utils.toWei("10"))
      assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei(".4987") > 0 , "mint of tokens should be correct")
      assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei(".4987") < web3.utils.toWei(".01") , "mint of tokens should be correct")
      await h.expectThrow(charon.connect(accounts[1]).transfer(accounts[3].address, web3.utils.toWei(".1")))
      await charon.connect(accounts[1]).approve(accounts[2].address, web3.utils.toWei("100"))
      await h.expectThrow(charon.connect(accounts[2]).transferFrom(accounts[1].address, accounts[3].address,web3.utils.toWei(".1")))
      for(i=0;i<500;i++){
        await charon.checkDrip();
      }
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1005") == 0, "record balancesynth should go up 6")
      assert(await charon.singleCHDLPToDrip() - web3.utils.toWei("5") == 0, "record balancesynth should go up 6")
      await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      await charon.connect(accounts[1]).lpSingleCHD(web3.utils.toWei("10"),0)
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1005") == 0, "record balancesynth should be correct")
      assert(await charon.dripRate() == web3.utils.toWei(".015"), "drip rate should be correct")
      assert(await charon.singleCHDLPToDrip() == web3.utils.toWei("15"))
      for(i=0;i<500;i++){
        await charon.checkDrip();
      }
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1012.5") == 0, "record balancesynth should go up 6")
      assert(await charon.singleCHDLPToDrip() - web3.utils.toWei("7.5") == 0, "record balancesynth should go up 6")
      await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      await charon.connect(accounts[1]).lpSingleCHD(web3.utils.toWei("10"),0)
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1012.5") == 0, "record balancesynth should be correct")
      assert(await charon.dripRate() == web3.utils.toWei(".0175"), "drip rate should be correct")
      assert(await charon.singleCHDLPToDrip() == web3.utils.toWei("17.5"))
      for(i=0;i<500;i++){
        await charon.checkDrip();
      }
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1021.25") == 0, "record balancesynth should go up 7")
      assert(await charon.singleCHDLPToDrip() - web3.utils.toWei("8.75") == 0, "record balancesynth should go up 6")
      for(i=0;i<500;i++){
        await charon.checkDrip();
      }
      assert(await charon.singleCHDLPToDrip() == 0, "drip should be gone")
      assert(await charon.recordBalanceSynth() - web3.utils.toWei("1030") == 0, "record balancesynth should be correct")
      assert(await chd.balanceOf(accounts[1].address)*1 - web3.utils.toWei("970") == 0, "contractsynth should take tokens")
    })
});
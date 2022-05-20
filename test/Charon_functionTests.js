const { expect } = require("chai");
var assert = require('assert');
const web3 = require('web3');
const fs = require('fs')
const { takeSnapshot, revertSnapshot } = require('./helpers/ganacheHelper')
const websnarkUtils = require('websnark/src/utils')
const buildGroth16 = require('websnark/src/groth16')
const stringifyBigInts = require('websnark/tools/stringifybigint').stringifyBigInts
const snarkjs = require('snarkjs')
const bigInt = snarkjs.bigInt
const crypto = require('crypto')
const circomlib = require('circomlib')
const MerkleTree = require('fixed-merkle-tree')
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")
const h = require("usingtellor/test/helpers/helpers.js");
circuit = require('../build/circuits/withdraw.json')
proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer
hasherArtifact = require('../build/Hasher.json')


const rbigint = (nbytes) => snarkjs.bigInt.leBuff2int(crypto.randomBytes(nbytes))
const pedersenHash = (data) => circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0]
const toFixedHex = (number, length = 32) =>
  '0x' +
  bigInt(number)
    .toString(16)
    .padStart(length * 2, '0')
const getRandomRecipient = () => rbigint(20)

function generateDeposit() {
  let deposit = {
    secret: rbigint(31),
    nullifier: rbigint(31),
  }
  const preimage = Buffer.concat([deposit.nullifier.leInt2Buff(31), deposit.secret.leInt2Buff(31)])
  deposit.commitment = pedersenHash(preimage)
  return deposit
}

//to do - figure out how to deploy hasher on different chain
//figure out how to have different curves for multiple chains

//instructions
//npm run build
//move Verifier.sol from build/circuits to contracts/helpers
//npx run scripts/generateHasher.js (generates hasher artifact)
//npx hardhat compile
//npx hardhat test

describe("Charon Funciton Tests", function() {
  let charon,cfac,ivfac,ihfac,verifier,tellor,accounts,token;
  let charon2,verifier2,tellor2, token2;
  let hasher,hasher2;
  let denomination = web3.utils.toWei("10")
  let tree
  let merkleTreeHeight = 20 //no idea (range is 0 to 32, they use 20 and 16 in tests)
  let run = 0;
  let fee = 0;//what range should this be in?
  let mainnetBlock = 0;
  let groth16
  let abiCoder = new ethers.utils.AbiCoder();

  beforeEach("deploy and setup mixer", async function() {
    tree = new MerkleTree(merkleTreeHeight)
    groth16 = await buildGroth16()
    accounts = await ethers.getSigners();
    ivfac = await ethers.getContractFactory("contracts/helpers/Verifier.sol:Verifier");
    verifier = await ivfac.deploy()
    await verifier.deployed();
    let hvfac = await ethers.getContractFactory(hasherArtifact.abi,hasherArtifact.bytecode);
    hasher = await hvfac.deploy();
    await hasher.deployed();
    //deploy mock token
    tfac = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    token = await tfac.deploy("Dissapearing Space Monkey","DSM");
    await token.deployed();
    //token = await ethers.getContractAt("contracts/mocks/MockERC20.sol:MockERC20", ERC20Addy);
    await token.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
    //deploy tellor
    let TellorOracle = await ethers.getContractFactory(abi, bytecode);
    tellor = await TellorOracle.deploy();
    await tellor.deployed();
    //deploy charon
    cfac = await ethers.getContractFactory("contracts/Charon.sol:Charon");
    charon= await cfac.deploy(verifier.address,hasher.address,token.address,fee,tellor.address,denomination,merkleTreeHeight);
    await charon.deployed();
    //now deploy on other chain (same chain, but we pretend w/ oracles)
        //deploy mock token
        verifier2 = await ivfac.deploy()
        await verifier2.deployed();
        token2 = await tfac.deploy("Dissapearing Space Monkey2","DSM2");
        await token2.deployed();
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        tellor2 = await TellorOracle.deploy();
        await tellor2.deployed();
        hasher2 = await hvfac.deploy();
        await hasher2.deployed();
        charon2= await cfac.deploy(verifier2.address,hasher2.address,token2.address,fee,tellor2.address,denomination,merkleTreeHeight);
        await charon2.deployed();
    //now set both of them. 
    await token.approve(charon.address,web3.utils.toWei("100"))//100
    await token2.approve(charon2.address,web3.utils.toWei("100"))//100
    await charon.bind(web3.utils.toWei("100"),web3.utils.toWei("100"));
    await charon2.bind(web3.utils.toWei("100"),web3.utils.toWei("100"))
    await charon.finalize();
    await charon2.finalize();

  });
  it("Test Constructor", async function() {
    assert(await charon.tellor() == tellor.address, "tellor address should be set")
    assert(await charon.levels() == merkleTreeHeight, "merkle Tree height should be set")
    assert(await charon.hasher() == hasher.address, "hasher should be set")
    assert(await charon.verifier() == verifier.address, "verifier should be set")
    assert(await charon.token() - token.address == 0, "token should be set")
    assert(await charon.fee() == fee, "fee should be set")
    assert(await charon.denomination() == denomination, "denomination should be set")
    assert(await charon.controller() == accounts[0].address, "controller should be set")
  });
  it("Test changeController", async function() {
    await charon.changeController(accounts[1].address)
    assert(await charon.controller() == accounts[1].address, "controller should change")
  });
  it("Test depositToOtherChain", async function() {
    const commitment = toFixedHex(43)
    await token.mint(accounts[1].address,web3.utils.toWei("100"))
    await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
    await charon.connect(accounts[1]).depositToOtherChain(commitment);
    assert(await charon.getDepositCommitmentsById(1) == commitment, "commitment should be stored")
    assert(await charon.getDepositIdByCommitment(commitment) == 1, "reverse commitment mapping should work")
    assert(await charon.didDepositCommitment(commitment), "didDeposit should be true")
    assert(await charon.recordBalance() == web3.utils.toWei("110"), "recordBalance should go up")
    assert(await token.balanceOf(accounts[1].address) == web3.utils.toWei("90"), "balance should change properly")
  });
  it("Test finalize", async function() {
    let testCharon = await cfac.deploy(verifier2.address,hasher2.address,token2.address,fee,tellor2.address,denomination,merkleTreeHeight);
    await testCharon.deployed();
    await h.expectThrow(testCharon.connect(accounts[1]).finalize())//must be controller
    await testCharon.finalize();
    await h.expectThrow(testCharon.finalize())//already finalized
    assert(await testCharon.finalized(), "should be finalized")
    assert(await testCharon.balanceOf(accounts[0].address) - await testCharon.INIT_POOL_SUPPLY() == 0, "should have full balance")
  });
  it("Test lpDeposit", async function() {
    await token.mint(accounts[1].address,web3.utils.toWei("100"))
    await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
    let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
                                          web3.utils.toWei("1"),//tokenWeightIn
                                          web3.utils.toWei("100"),//poolSupply
                                          web3.utils.toWei("2"),//totalWeight
                                          web3.utils.toWei("10")//tokenamountIn
                                          )
    assert(minOut >= web3.utils.toWei("4.88"), "should be greater than this")
    await charon.connect(accounts[1]).lpDeposit(web3.utils.toWei("10"),minOut)
    assert(await charon.recordBalance() == web3.utils.toWei("110"), "record balance should be correct")
    assert(await charon.balanceOf(accounts[1].address) - minOut == 0, "mint of tokens should be correct")
    assert(await token.balanceOf(accounts[1].address) == web3.utils.toWei("90"), "contract should take tokens")
  });
  it("Test lpWithdraw", async function() {
    await token.mint(accounts[1].address,web3.utils.toWei("100"))
    await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
    let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
                                          web3.utils.toWei("1"),//tokenWeightIn
                                          web3.utils.toWei("100"),//poolSupply
                                          web3.utils.toWei("2"),//totalWeight
                                          web3.utils.toWei("10")//tokenamountIn
                                          )
    await charon.connect(accounts[1]).lpDeposit(web3.utils.toWei("10"),minOut)
    let poolSupply = await charon.totalSupply()
    let recordBalance = await charon.recordBalance() 
    let poolOut = await charon.calcSingleOutGivenPoolIn(recordBalance,//tokenBalanceOut
                                  web3.utils.toWei("1"),//tokenWeightOut
                                  poolSupply,
                                  web3.utils.toWei("2"),//totalWeight
                                  minOut,//poolAmountIn
                                  0//swapfee
    )
    assert(poolOut >= web3.utils.toWei("10"), "should spit out correct amount of tokens")
    await charon.connect(accounts[1]).lpWithdraw(minOut, poolOut)
    assert(await charon.recordBalance() > web3.utils.toWei("99"), "record balance should be back to correct" )
    assert(web3.utils.toWei("101") - await charon.recordBalance() > 0, "record balance should be back to correct" )
    //test fee later
    assert(await charon.balanceOf(accounts[1].address) == 0, "all pool tokens should be gone")
    assert(await token.balanceOf(accounts[1].address) - web3.utils.toWei("99") > 0, "token balance should be back to correct" )
    assert(web3.utils.toWei("101") - await token.balanceOf(accounts[1].address) > 0, "token balance should be back to correct" )
    });
  it("Test oracleDeposit", async function() {
    deposit = await generateDeposit()
    tree.insert(deposit.commitment)
    await token.approve(charon.address,denomination)
    await charon.depositToOtherChain(toFixedHex(deposit.commitment));
    let depositId = await charon.getDepositIdByCommitment(toFixedHex(deposit.commitment))
    queryData = abiCoder.encode(
      ['string', 'bytes'],
      ['Charon', abiCoder.encode(
        ['uint256','uint256'],
        [1,depositId]
      )]
    );
    queryId = h.hash(queryData)
    let nonce = await tellor2.getNewValueCountbyQueryId(queryId)
    await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
    await h.advanceTime(43200)//12 hours
    await charon2.oracleDeposit(1,depositId);
    assert(await charon2.isCommitment(toFixedHex(deposit.commitment)), "should be a commitment")
    assert(await charon2.isSpent(toFixedHex(pedersenHash(deposit.nullifier.leInt2Buff(31)))) == false, "nullifierHash should be false")
    });
  it("Test secretWithdraw - no LP", async function() {
    await token.mint(accounts[2].address,denomination);
    await token.connect(accounts[2]).approve(charon.address,denomination)
    let deposit;
    let _root = 0;
    let queryData, queryId,depositId,nonce;
      deposit = await generateDeposit()
      tree.insert(deposit.commitment)
      await charon.connect(accounts[2]).depositToOtherChain(toFixedHex(deposit.commitment));
      const { pathElements, pathIndices } = tree.path(0)
      // Circuit input
      let myR = await charon.getLastRoot();
      console.log(myR)
      console.log(tree.root())
      const input = stringifyBigInts({
        root: tree.root(),
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer: accounts[0].address,
        receiver: accounts[1].address,
        fee: 0,
        refund: 0,
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: pathElements,
        pathIndex: pathIndices,
      })
      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)
      //pass value w/tellor
      depositId = await charon.getDepositIdByCommitment(toFixedHex(deposit.commitment))
      queryData = abiCoder.encode(
        ['string', 'bytes'],
        ['Charon', abiCoder.encode(
          ['uint256','uint256'],
          [1,depositId]
        )]
      );
      queryId = h.hash(queryData)
      nonce = await tellor2.getNewValueCountbyQueryId(queryId)
      await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
      await h.advanceTime(43200)//12 hours
      //withdraw on other chain
      await charon2.oracleDeposit(1,depositId)
      let p = await verifier["verifyProof(bytes,uint256[6])"](proof,[0,
        toFixedHex(input.nullifierHash),
        toFixedHex(input.receiver),
        toFixedHex(input.relayer),0,0])
      console.log("verified?", p)
      assert(await charon2.isSpent(toFixedHex(input.nullifierHash)) == false, "nullifierHash should be false")
      let isA = await charon2.isSpentArray([toFixedHex(input.nullifierHash)]);
      assert(isA[0] == false, "value in array should be false")
      let initSynth = await charon2.recordBalanceSynth()
      let initRecord = await charon2.recordBalance()
      await charon2.secretWithdraw(proof,
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.receiver, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.refund),false)
      assert(await charon2.isSpent(toFixedHex(input.nullifierHash)), "nullifierHash should be true")
      isA = await charon2.isSpentArray([toFixedHex(input.nullifierHash)]);
      assert(isA[0],"should be spent")
      let tokenOut = await charon2.calcOutGivenIn(
            web3.utils.toWei("100"),
            web3.utils.toWei("1"),
            web3.utils.toWei("100"), 
            web3.utils.toWei("1"),
            denomination,
            0
      )
      assert(await charon2.recordBalanceSynth() - initSynth == 0, "synth balance should be the same")
      assert(await charon2.recordBalance() == initRecord - tokenOut, "recordBalance should change")
      assert(await token2.balanceOf(accounts[1].address) - tokenOut == 0, "should be paid")
  });
  it("Test secretWithdraw - to LP", async function() {
    await token.mint(accounts[2].address,denomination);
    await token.connect(accounts[2]).approve(charon.address,denomination)
    let deposit;
    let _root = 0;
    let queryData, queryId,depositId,nonce;
      deposit = await generateDeposit()
      tree.insert(deposit.commitment)
      await charon.connect(accounts[2]).depositToOtherChain(toFixedHex(deposit.commitment));
      const { pathElements, pathIndices } = tree.path(_root)
      _root++
      // Circuit input
      const input = stringifyBigInts({
        root: tree.root(),
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer: toFixedHex(accounts[0].address),
        receiver: toFixedHex(accounts[1].address),
        fee: 0,
        refund: 0,
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: pathElements,
        pathIndex: pathIndices,
      })
      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)
      //pass value w/tellor
      depositId = await charon.getDepositIdByCommitment(toFixedHex(deposit.commitment))
      queryData = abiCoder.encode(
        ['string', 'bytes'],
        ['Charon', abiCoder.encode(
          ['uint256','uint256'],
          [1,depositId]
        )]
      );
      queryId = h.hash(queryData)
      nonce = await tellor2.getNewValueCountbyQueryId(queryId)
      await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
      await h.advanceTime(43200)//12 hours
      //withdraw on other chain
      await charon2.oracleDeposit(1,depositId)
      let p = await verifier["verifyProof(bytes,uint256[6])"](proof,[0,
        toFixedHex(input.nullifierHash),
        toFixedHex(input.receiver),
        toFixedHex(input.relayer),0,0])
      console.log("verified?", p)
      assert(await charon2.isSpent(toFixedHex(input.nullifierHash)) == false, "nullifierHash should be false")
      let isA = await charon2.isSpentArray([toFixedHex(input.nullifierHash)]);
      assert(isA[0] == false, "value in array should be false")
      let initSynth = await charon2.recordBalanceSynth()
      let initRecord = await charon2.recordBalance()
      await charon2.secretWithdraw(proof,
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.receiver, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.refund),true)
      assert(await charon2.isSpent(toFixedHex(input.nullifierHash)), "nullifierHash should be true")
      isA = await charon2.isSpentArray([toFixedHex(input.nullifierHash)]);
      assert(isA[0] == true, "should be spent")
      let poolOut = await charon2.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
      web3.utils.toWei("1"),//tokenWeightIn
      web3.utils.toWei("100"),//poolSupply
      web3.utils.toWei("2"),//totalWeight
      denomination
      )
  assert(await charon2.recordBalanceSynth() - initSynth - denomination == 0, "synth balance should go up")
  assert(await charon2.recordBalance() - initRecord == 0, "recordBalance should be the same")
  assert(await token2.balanceOf(accounts[1].address) == 0, "no tokens should be paid")
  assert(await charon2.balanceOf(accounts[1].address) - poolOut == 0, "pool tokens paid")
  });
});

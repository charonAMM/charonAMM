const { expect } = require("chai");
var assert = require('assert');
const web3 = require('web3');
const fs = require('fs')
const { toBN } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('./helpers/ganacheHelper')
const websnarkUtils = require('websnark/src/utils')
const buildGroth16 = require('websnark/src/groth16')
const stringifyBigInts = require('websnark/tools/stringifybigint').stringifyBigInts
const snarkjs = require('snarkjs')
const bigInt = snarkjs.bigInt
const crypto = require('crypto')
const fetch = require('node-fetch')
const circomlib = require('circomlib')
const MerkleTree = require('fixed-merkle-tree')
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")
const h = require("usingtellor/test/helpers/helpers.js");
circuit = require('../build/circuits/withdraw.json')
proving_key = fs.readFileSync('build/circuits/withdraw_proving_key.bin').buffer

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

describe("Charon Funciton Tests", function() {
  let charon,cfac,ivfac,ihfac,verifier,tellor,accounts,token;
  let charon2,verifier2,tellor2, token2;
  let hasher= "0x83584f83f26af4edda9cbe8c730bc87c364b28fe";
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
    if(run == 0){
      const directors = await fetch('https://api.blockcypher.com/v1/eth/main').then(response => response.json());
      mainnetBlock = directors.height - 15;
      console.log("     Forking from block: ",mainnetBlock)
      run = 1;
    }
    accounts = await ethers.getSigners();
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{forking: {
            jsonRpcUrl: hre.config.networks.hardhat.forking.url,
            blockNumber: mainnetBlock
          },},],
      });
    //deploy verifier
    ivfac = await ethers.getContractFactory("contracts/helpers/Verifier.sol:Verifier");
    verifier = await ivfac.deploy()
    await verifier.deployed();
    //deploy mock token
    tfac = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
    token = await tfac.deploy("Dissapearing Space Monkey","DSM");
    await token.deployed();
    await token.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
    //deploy tellor
    let TellorOracle = await ethers.getContractFactory(abi, bytecode);
    tellor = await TellorOracle.deploy();
    await tellor.deployed();
    //deploy charon
    cfac = await ethers.getContractFactory("contracts/Charon.sol:Charon");
    charon= await cfac.deploy(verifier.address,hasher,token.address,fee,tellor.address,denomination,merkleTreeHeight);
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
        charon2= await cfac.deploy(verifier2.address,hasher,token2.address,fee,tellor2.address,denomination,merkleTreeHeight);
        await charon2.deployed();


    //now set both of them. 
    await token.approve(charon.address,web3.utils.toWei("100000"))//100k
    await charon.bind(web3.utils.toWei("100000"))
    await token2.approve(charon2.address,web3.utils.toWei("100000"))//100k
    await charon2.bind(web3.utils.toWei("100000"))
    await token.approve(charon.address,web3.utils.toWei("100"))//100k
    await token2.approve(charon.address,web3.utils.toWei("100"))//100k
    let deposit;
    let _root = 0;
    let queryData, queryId,depositId,nonce;
    for(var i=0;i<1;i++){
      deposit = await generateDeposit()
      tree.insert(deposit.commitment)
      await charon.depositToOtherChain(toFixedHex(deposit.commitment));
      const { pathElements, pathIndices } = tree.path(_root)
      _root++
      // Circuit input
      const input = stringifyBigInts({
        root: tree.root(),
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer: accounts[0].address,
        recipient: accounts[1].address,
        fee: 0,
        refund: 0,
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: pathElements,
        pathIndices: pathIndices,
      })
      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund),
        true
      ]
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
      console.log(toFixedHex(deposit.commitment))
      await h.advanceTime(43200)//12 hours
      //withdraw on other chain
      await charon2.oracleDeposit(1,depositId)
      await charon2.secretWithdraw(proof, ...args)

      //now do the same thing on the other chain
      deposit = generateDeposit()
      tree.insert(deposit.commitment)
      await charon2.depositToOtherChain(toFixedHex(deposit.commitment));
    }

    //deploy everything again on the next chain
    //can we assume it will work with two chains if just testing one?

  });
  it("Test Constructor", async function() {
    assert(await charon.tellor() == tellor.address, "tellor address should be set")
    assert(await charon.levels() == merkleTreeHeight, "merkle Tree height should be set")
    assert(await charon.hasher() == web3.utils.toChecksumAddress(hasher), "hasher should be set")
    assert(await charon.verifier() == verifier.address, "verifier should be set")
    assert(await charon.token() == token.address, "token should be set")
    assert(await charon.fee() == fee, "fee should be set")
    assert(await charon.denomination() == denomination, "denomination should be set")
    assert(await charon.controller() == accounts[0].address, "controller should be set")
  });
  it("Test bind", async function() {
    assert(await charon.recordBalance() == web3.utils.toWei("100000"), "record balance should be init")
    assert(await token.balanceOf(charon.address) == web3.utils.toWei("100000"), "charon should have balance")
    assert(await token.balanceOf(accounts[0]) == web3.utils.toWei("900000"), "controller balance should be lower")
  });
  it("Test changeController", async function() {
    await charon.changeController(accounts[1].address)
    assert(await charon.controller() == accounts[1].address, "controller should change")
  });
  it("Test depositToOtherChain", async function() {

    const commitment = toFixedHex(43)
    await token.connect(accounts[1]).approve(mixer.address,denomination)
    await mixer.connect(accounts[1]).deposit(commitment)
    assert(0==1)
  });
  it("Test finalize", async function() {
    assert(0==1)
  });
  it("Test lpDeposit", async function() {
    assert(0==1)
  });
  it("Test lpWithdraw", async function() {
    assert(0==1)
  });
  it("Test oracleDeposit", async function() {
    assert(0==1)
  });
  it("Test secretWithdraw - no LP", async function() {
    assert(0==1)
  });
  it("Test secretWithdraw - to LP", async function() {
    assert(0==1)
  });
  it("Test getDepositCommitmentsById", async function() {
    assert(0==1)
  });
  it("Test isSpent", async function() {
    assert(0==1)
  });
  it("Test isSpentArray", async function() {
    assert(0==1)
  });
  it("Test bytesToBytes32", async function() {
    assert(0==1)
  });
});

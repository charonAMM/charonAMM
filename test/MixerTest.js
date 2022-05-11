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
const circomlib = require('circomlib')
const MerkleTree = require('fixed-merkle-tree')
const fetch = require('node-fetch')
const ETH_AMOUNT=100000000000000000
require("@nomiclabs/hardhat-ethers");
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

describe("Mixer Tests", function() {
  let mixer,mfac,ivfac,ihfac,verifier,token,tree;
  let hasher= "0x83584f83f26af4edda9cbe8c730bc87c364b28fe";
  let denomination = web3.utils.toWei("10")
  let merkleTreeHeight = 20 //no idea (range is 0 to 32, they use 20 and 16 in tests)
  let run = 0;
  let mainnetBlock = 0;
  let groth16
  let relayer, recipient

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
    await token.mint(accounts[1].address,web3.utils.toWei("1000000"))
    //deploy mixer
    mfac = await ethers.getContractFactory("contracts/Mixer.sol:Mixer");
    mixer = await mfac.deploy(verifier.address,hasher,denomination,merkleTreeHeight,token.address);
    await mixer.deployed();
  });
  it("Test Deposit", async function() {
    const commitment = toFixedHex(43)
    await token.connect(accounts[1]).approve(mixer.address,denomination)
    await mixer.connect(accounts[1]).deposit(commitment)
    let val = await mixer.commitments(commitment)
    console.log("here")
    assert(val == true, "commitment should be deposited")
    val = await mixer.currentRootIndex.call()
    assert(val == 1, "index should grow")
    val = await token.balanceOf(mixer.address)
    assert(val == denomination, "balance should be deposited")
  });
  it("Test Withdraw", async function() {
      const deposit = generateDeposit()
      const user = accounts[4].address
      relayer = accounts[1].address
      recipient = getRandomRecipient()
      let operator = accounts[0].address
      const fee = bigInt(ETH_AMOUNT).shr(1) || bigInt(1e17)
      const refund = ETH_AMOUNT || '1000000000000000000' // 1 ether
      tree.insert(deposit.commitment)
      await token.mint(user, denomination)
      const balanceUserBefore = await token.balanceOf(user)
      await token.connect(accounts[4]).approve(mixer.address, denomination)
      await mixer.connect(accounts[4]).deposit(toFixedHex(deposit.commitment),{gasPrice: '0' })
      const balanceUserAfter = await token.balanceOf(user)
      assert(balanceUserAfter == balanceUserBefore - denomination,"balances should be correct")
      const { pathElements, pathIndices } = tree.path(0)
      // Circuit input
      const input = stringifyBigInts({
        // public
        root: tree.root(),
        nullifierHash: pedersenHash(deposit.nullifier.leInt2Buff(31)),
        relayer,
        recipient,
        fee,
        refund,
        // private
        nullifier: deposit.nullifier,
        secret: deposit.secret,
        pathElements: pathElements,
        pathIndices: pathIndices,
      })
      const proofData = await websnarkUtils.genWitnessAndProve(groth16, input, circuit, proving_key)
      const { proof } = websnarkUtils.toSolidityInput(proofData)
      const balanceMixerBefore = await token.balanceOf(mixer.address)
      const balanceRelayerBefore = await token.balanceOf(relayer)
      const balanceReceiverBefore = await token.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceOperatorBefore = await ethers.provider.getBalance(accounts[0].address)
      const ethBalanceReceiverBefore = await ethers.provider.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerBefore = await ethers.provider.getBalance(relayer)
      let isSpent = await mixer.isSpent(toFixedHex(input.nullifierHash))
      assert(!isSpent, "should not be spent")
      const args = [ 
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund),
      ]
      console.log("here")
      const { logs } = await mixer.connect(relayer).withdraw(proof, ...args, { value: refund,gasPrice: '0' })
      console.log("wdraw")
      const balanceMixerAfter = await token.balanceOf(mixer.address)
      const balanceRelayerAfter = await token.balanceOf(relayer)
      const ethBalanceOperatorAfter = await ethers.provider.getBalance(operator)
      const balanceReceiverAfter = await token.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceReceiverAfter = await ethers.provider.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerAfter = await ethers.provider.getBalance(relayer)
      const feeBN = toBN(fee.toString())
      balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(denomination)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).add(feeBN))
      balanceReceiverAfter.should.be.eq.BN(
        toBN(balanceReceiverBefore).add(toBN(denomination).sub(feeBN)),
      )
      ethBalanceOperatorAfter.should.be.eq.BN(toBN(ethBalanceOperatorBefore))
      ethBalanceReceiverAfter.should.be.eq.BN(toBN(ethBalanceReceiverBefore).add(toBN(refund)))
      ethBalanceRelayerAfter.should.be.eq.BN(toBN(ethBalanceRelayerBefore).sub(toBN(refund)))
      logs[0].event.should.be.equal('Withdrawal')
      logs[0].args.nullifierHash.should.be.equal(toFixedHex(input.nullifierHash))
      logs[0].args.relayer.should.be.eq.BN(relayer)
      logs[0].args.fee.should.be.eq.BN(feeBN)
      isSpent = await mixer.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(true)
  });
});

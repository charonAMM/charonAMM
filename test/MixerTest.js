const { expect } = require("chai");
var assert = require('assert');
const web3 = require('web3');
const fs = require('fs')
const { toBN } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../scripts/ganacheHelper')
const websnarkUtils = require('websnark/src/utils')
const buildGroth16 = require('websnark/src/groth16')
const stringifyBigInts = require('websnark/tools/stringifybigint').stringifyBigInts
const snarkjs = require('snarkjs')
const bigInt = snarkjs.bigInt
const crypto = require('crypto')
const circomlib = require('circomlib')
const MerkleTree = require('fixed-merkle-tree')

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
  let mixer,mfac,ivfac,ihfac,verifier;
  let hasher= 0x83584f83f26af4edda9cbe8c730bc87c364b28fe;
  let denomination = web3.utils.toWei("10")
  let tree
  let merkleTreeHeight = 20 //no idea (range is 0 to 32, they use 20 and 16 in tests)

  beforeEach("deploy and setup mixer", async function() {
    tree = new MerkleTree(merkleTreeHeight)
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
    tfac = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    token = await token.deploy();
    await token.deployed("Dissapearing Space Monkey","DSM");
    await token.mint(accounts[0],web3.utils.toWei("1000000"))
    //deploy mixer
    mfac = await ethers.getContractFactory("contracts/Mixer.sol:Mixer");
    mixer = await mfac.deploy(verifier.address,hasher,denomination,merkleTreeHeight,token.address);
    await mixer.deployed();

  });
  it("Test Deposit", async function() {
    const commitment = toFixedHex(43)
    await token.approve(mixer.address,denomination)
    let { logs } = await mixer.deposit(commitment, { from: sender })
    logs[0].event.should.be.equal('Deposit')
    logs[0].args.commitment.should.be.equal(commitment)
    logs[0].args.leafIndex.should.be.eq.BN(0)
  });
  it("Test Withdraw", async function() {
      const deposit = generateDeposit()
      const user = accounts[4]
      tree.insert(deposit.commitment)
      await token.mint(user, tokenDenomination)
      const balanceUserBefore = await token.balanceOf(user)
      await token.approve(mixer.address, tokenDenomination, { from: user })
      await mixer.deposit(toFixedHex(deposit.commitment), { from: user, gasPrice: '0' })
      const balanceUserAfter = await token.balanceOf(user)
      balanceUserAfter.should.be.eq.BN(toBN(balanceUserBefore).sub(toBN(tokenDenomination)))
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
      const ethBalanceOperatorBefore = await web3.eth.getBalance(operator)
      const ethBalanceReceiverBefore = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerBefore = await web3.eth.getBalance(relayer)
      let isSpent = await mixer.isSpent(toFixedHex(input.nullifierHash))
      isSpent.should.be.equal(false)
      const args = [
        toFixedHex(input.root),
        toFixedHex(input.nullifierHash),
        toFixedHex(input.recipient, 20),
        toFixedHex(input.relayer, 20),
        toFixedHex(input.fee),
        toFixedHex(input.refund),
      ]
      const { logs } = await mixer.withdraw(proof, ...args, { value: refund, from: relayer, gasPrice: '0' })
      const balanceMixerAfter = await token.balanceOf(mixer.address)
      const balanceRelayerAfter = await token.balanceOf(relayer)
      const ethBalanceOperatorAfter = await web3.eth.getBalance(operator)
      const balanceReceiverAfter = await token.balanceOf(toFixedHex(recipient, 20))
      const ethBalanceReceiverAfter = await web3.eth.getBalance(toFixedHex(recipient, 20))
      const ethBalanceRelayerAfter = await web3.eth.getBalance(relayer)
      const feeBN = toBN(fee.toString())
      balanceMixerAfter.should.be.eq.BN(toBN(balanceMixerBefore).sub(toBN(tokenDenomination)))
      balanceRelayerAfter.should.be.eq.BN(toBN(balanceRelayerBefore).add(feeBN))
      balanceReceiverAfter.should.be.eq.BN(
        toBN(balanceReceiverBefore).add(toBN(tokenDenomination).sub(feeBN)),
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

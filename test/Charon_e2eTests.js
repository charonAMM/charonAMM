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
const fetch = require('node-fetch')
const crypto = require('crypto')
const circomlib = require('circomlib')
const MerkleTree = require('fixed-merkle-tree')
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")
const h = require("usingtellor/test/helpers/helpers.js");
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

describe("Charon e2e Tests", function() {
  let mixer,mfac,ivfac,ihfac,verifier,tellor;
  let hasher= 0x83584f83f26af4edda9cbe8c730bc87c364b28fe;
  let denomination = web3.utils.toWei("10")
  let tree
  let merkleTreeHeight = 20 //no idea (range is 0 to 32, they use 20 and 16 in tests)
  let run = 0;
  let mainnetBlock = 0;
  
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
      tfac = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
      token = await tfac.deploy("Dissapearing Space Monkey","DSM");
      await token.deployed();
      await token.mint(accounts[0].address,web3.utils.toWei("1000000"))
      //deploy tellor
      let TellorOracle = await ethers.getContractFactory(abi, bytecode);
      tellor = await TellorOracle.deploy();
      await tellor.deployed();
      //deploy charon
      cfac = await ethers.getContractFactory("contracts/Charon.sol:Charon");
      charon= await cfac.deploy(verifier.address,hasher,token.address,fee,tellor.address,denomination,merkleTreeHeight);
      await charon.deployed();
      //deploy everything again on the next chain
      //can we assume it will work with two chains if just testing one?

  });
  
  it("Test lots of deposits and withdraw", async function() {
    assert(0==1)
  });
  it("Test disputes on tellorValue", async function() {
    assert(0==1)
  });
  it("Test malicious oracle drain", async function() {
    assert(0==1)
  });

});

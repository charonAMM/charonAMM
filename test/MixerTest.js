const { AbiCoder } = require("@ethersproject/abi");
const { expect } = require("chai");
const h = require("./helpers/helpers");
var assert = require('assert');
const web3 = require('web3');
const { ethers } = require("hardhat");
const { stakeAmount } = require("./helpers/helpers");
const { keccak256 } = require("ethers/lib/utils");

describe("Mixer Tests", function() {
  let mixer,mfac,ivfac,ihfac,verifier;
  let hasher= 0x83584f83f26af4edda9cbe8c730bc87c364b28fe;

  beforeEach("deploy and setup mixer", async function() {

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
    //deploy mixer
    mfac = await ethers.getContractFactory("contracts/Mixer.sol:Mixer");
    let denomination = web3.utils.toWei("10")
    let merkleTreeHeight = 16 //no idea (range is 0 to 32)
    mixer = await mfac.deploy(verifier.address,hasher,denomination,merkleTreeHeight,token.address);
    await mixer.deployed();

  });
  it("Test Deposit", async function() {
  });
  it("Test Deposit", async function() {
  });
  it("Test isSpent", async function() {
  });
  it("Test isSpentArray", async function() {
  });
  it("E2E Test", async function() {
  });


});

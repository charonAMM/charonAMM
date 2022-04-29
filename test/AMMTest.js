const { AbiCoder } = require("@ethersproject/abi");
const { expect } = require("chai");
const h = require("./helpers/helpers");
var assert = require('assert');
const web3 = require('web3');
const { ethers } = require("hardhat");
const { stakeAmount } = require("./helpers/helpers");
const { keccak256 } = require("ethers/lib/utils");

describe("End-to-End Tests - Nine", function() {

  //const tellorMaster = "0x88dF592F8eb5D7Bd38bFeF7dEb0fBc02cf3778a0"
  const swapFee = 10e16 //1%
  let tfac,token1,token2,afac,amm

  beforeEach("deploy and setup TellorX", async function() {
    //deploy two tokens
    tfac = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    token1 = await tfac.deploy("WrappedETH","WETH");
    token2 = await tfac.deploy("Dissapearing Space Monkey","DSM")
    await token1.deployed();

    //deploy AMM
    afac = await ethers.getContractFactory("contracts/AMM.sol:AMM");
    amm = await afac.deploy(swapFee);
    await amm.deployed();

    //mint initial token supplies (1M)
    await token1.mint(accounts[0],web3.utils.toWei("1000000"))
    await token2.mint(accounts[0],web3.utils.toWei("1000000"))

  });
  it("e2eTest", async function() {
  
  });


});

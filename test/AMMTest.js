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
    await token1.mint(accounts[0],web3.utils.toWei("1000000"))//1M
    await token2.mint(accounts[0],web3.utils.toWei("2000000"))//2M

    //approve tokens 
    await token1.approve(amm.address,web3.utils.toWei("100000"))//100k
    await token2.approve(amm.address,web3.utils.toWei("200000"))//200k
    //bind tokens
    await amm.bind(token1.address,web3.utils.toWei("100000"),web3.utils.toWei("1")) //argument on end is denorm weight (can weight multi tokens)
    await amm.bind(token2.address,web3.utils.toWei("200000"),web3.utils.toWei("1"))
    //finalize pool
    await amm.finalize();

  });
  it("e2eTest", async function() {

      //user gets tokesn
      await token1.transfer(accounts[1],web3.utils.toWei("100000"))
      await token2.transfer(accounts[2],web3.utils.toWei("100000"))
      //user approves tokens
      await token1.connect(accounts[1]).approve(amm.address,web3.utils.toWei("100"))
      //user joinPool
      await amm.connect(accounts[1])joinPool(web3.utils.toWei("10"),web3.utils.toWei("100"))//pool amount out, maxIn
      //user runs swapExactAmountIn (trades with a specific input)
      await amm.connect(accounts[2].swapExactAmountIn(token2.address,web3.utils.toWei("10"),token2.addreess,web3.utils.toWei("5"),2))
      //user runs swapExactAmountOut (variable amount in?)

        //test other functions?  What are they all and which one do we want? 
      //Test AMM pool token interactions
  });


});

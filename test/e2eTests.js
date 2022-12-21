const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect, assert } = require('chai')
const { utils } = ethers
const web3 = require('web3');
const abiCoder = new ethers.utils.AbiCoder()
const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
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
    let verifier2,verifier16,token,charon,hasher,token2,charon2,oracle, oracle2;
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
        await charon.finalize([2],[charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address);
        await charon2.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd2.address);
    });
    it("can you oracleDeposit same id twice", async function() {
    })
    it("Oracle Attack (censors)", async function() {
    })
    it("Oracle attack (bad value pushed through, liquidity drain properly before 12 hours)", async function() {
    })
    it("Flash loan scenario", async function() {
    })
    it("rug pull (either side pulls all liquidity)", async function() {
    })
    it("underlying token freezes (tellor upgrade example), allow single sided withdraw", async function() {
    })
    it("Add a new chain", async function() {
    })
    it("Remove a chain", async function() {
    })
    it("Multiple back and forths (oracle deposits on 3 different chains and withdrawals and trades)", async function() {
    })
    it("Lots of chains, lots of privacy transactioins, lots of withdrawals", async function() {
    })
    it("No way to send money and then withdraw on old UTXO", async function() {
    })
    it("No way to withdraw more than you put in", async function() {
    })
    it("Add LP rewards and pay them out", async function() {
    })
    it("Add User rewards and have them distribute correctly", async function() {
    })
    it("Test distribution of base fee", async function() {
    })
});
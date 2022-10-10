const { expect, assert } = require("chai");
const { ethers } = require("hardhat");
const web3 = require('web3');

describe("charon system - function tests", function() {
    let token;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        let fac = await ethers.getContractFactory("MockERC20");
        token = await fac.deploy(accounts[1].address,"mock token", "MT");
        await token.deployed();
    });
    console.log("Token.sol -- to write")
    it("constructor()", async function() {
            assert(await token.name() == "mock token")
            assert(await token.symbol() == "MT")
    });
    it("approve()", async function() {
    });
    it("transfer()", async function() {
    });
    it("transferFrom()", async function() {
    });
    it("allowance()", async function() {
    });
    it("balanceOf()", async function() {
    });
    it("decimals()", async function() {
        assert(await token.decimals() == 18, "decimals should be correct")
    });
    it("name()", async function() {
        assert(await token.name() == "mock token", "name should be correct")
    });
    it("symbol()", async function() {
        assert(await token.symbol() == "MT", "symbol should be correct")
    });
    it("totalSupply()", async function() {
    });
    it("_mint()", async function() {
    });
    it("_burn()", async function() {
    });
    it("_move()", async function() {
    });
    console.log("Math.sol -- to write")
    it("constructor()", async function() {
    });
    console.log("Oracle.sol -- to write")
    it("constructor()", async function() {
    });
    console.log("CHD.sol -- to write")
    it("constructor()", async function() {
    });
    console.log("MerkleTreeWithHistory.sol -- to write")
    it("constructor()", async function() {
    });
    console.log("Verifier16.sol -- to write")
    it("constructor()", async function() {
    });
    console.log("Verifier2.sol -- to write")
    it("constructor()", async function() {
    });
});

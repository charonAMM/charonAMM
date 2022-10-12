const { expect, assert } = require("chai");
const { ethers } = require("hardhat");
const web3 = require('web3');
const h = require("usingtellor/test/helpers/helpers.js");

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
        await token.connect(accounts[2]).approve(accounts[3].address,web3.utils.toWei("200"))
        assert(await token.allowance(accounts[2].address,accounts[3].address) == web3.utils.toWei("200"))
    });
    it("transfer()", async function() {
        await token.connect(accounts[1]).mint(accounts[2].address,web3.utils.toWei("100"))
        await token.connect(accounts[2]).transfer(accounts[3].address,web3.utils.toWei("20"))
        assert(await token.balanceOf(accounts[3].address) == web3.utils.toWei("20"), "transfer should work")
        await expect(token.connect(accounts[3]).transfer(accounts[5].address,web3.utils.toWei("100"))).to.be.reverted;
    });
    it("transferFrom()", async function() {
        await token.connect(accounts[1]).mint(accounts[2].address,web3.utils.toWei("100"))
        await token.connect(accounts[2]).approve(accounts[4].address,web3.utils.toWei("20"))
        await token.connect(accounts[4]).transferFrom(accounts[2].address,accounts[3].address,web3.utils.toWei("20"))
        assert(await token.balanceOf(accounts[3].address) == web3.utils.toWei("20"), "transfer should work")
        await expect(token.connect(accounts[3]).transferFrom(accounts[5].address,accounts[3].address,web3.utils.toWei("100"))).to.be.reverted;
    });
    it("decimals()", async function() {
        assert(await token.decimals() == 18, "decimals should be correct")
    });
    it("totalSupply()", async function() {
        await token.connect(accounts[1]).mint(accounts[2].address,web3.utils.toWei("100"))
        await token.connect(accounts[1]).mint(accounts[3].address,web3.utils.toWei("100"))
        await token.connect(accounts[1]).mint(accounts[4].address,web3.utils.toWei("100"))
        assert(await token.totalSupply() == web3.utils.toWei("300"))
    });
    it("_mint()", async function() {
        await token.connect(accounts[1]).mint(accounts[2].address,web3.utils.toWei("100"))
        assert(await token.balanceOf(accounts[2].address) == web3.utils.toWei("100"), "mint balance should be correct")
    });
    it("_burn()", async function() {
        await token.connect(accounts[1]).mint(accounts[2].address,web3.utils.toWei("100"))
        await token.connect(accounts[1]).burn(accounts[2].address,web3.utils.toWei("20"))
        assert(await token.balanceOf(accounts[2].address) == web3.utils.toWei("80"), "burn should work")
        await expect(token.connect(accounts[3]).burn(accounts[2].address,web3.utils.toWei("100"))).to.be.reverted;
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

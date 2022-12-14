const { expect, assert } = require("chai");
const { ethers } = require("hardhat");
const web3 = require('web3');
const h = require("usingtellor/test/helpers/helpers.js");
const abiCoder = new ethers.utils.AbiCoder()
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")

describe("charon system - function tests", function() {
    let token,math,chd,oracle,tellor;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        let fac = await ethers.getContractFactory("MockERC20");
        token = await fac.deploy(accounts[1].address,"mock token", "MT");
        await token.deployed();
        fac = await ethers.getContractFactory("MockMath")
        math = await fac.deploy()
        await math.deployed()
        fac = await ethers.getContractFactory("CHD")
        chd = await fac.deploy(accounts[1].address,"testchd","tc")
        await chd.deployed()
        let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor = await TellorOracle.deploy();
        await tellor.deployed();
        fac = await ethers.getContractFactory("Oracle")
        oracle = await fac.deploy(tellor.address)
        await oracle.deployed();
    });
    it("constructor()", async function() {
        console.log("Token.sol")
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
    it("calcSpotPrice()", async function() {
        console.log("Math.sol")
        assert(await math.calcSpotPrice(web3.utils.toWei("100"),web3.utils.toWei("10"),0) == web3.utils.toWei("10"), "spot price should be correct")
    });
    it("calcOutGivenIn()", async function() {
        assert(await math.calcOutGivenIn(web3.utils.toWei("1000"),web3.utils.toWei("100"),web3.utils.toWei("100"),0) == web3.utils.toWei("9.090909090909090900"), "spot price should be correct")
    });
    it("calcInGivenOut()", async function() {
        assert(await math.calcInGivenOut(web3.utils.toWei("1000"),web3.utils.toWei("100"),web3.utils.toWei("10"),0) == web3.utils.toWei("111.111111111111111000"), "ingivenout should be correct")
    });
    it("calcPoolOutGivenSingleIn(()", async function() {
        assert(await math.calcPoolOutGivenSingleIn(web3.utils.toWei("1000"),web3.utils.toWei("10"),web3.utils.toWei("100")) == web3.utils.toWei(".488088481710052490"), "pool out should be correct")
    });
    it("calcSingleOutGivenIn()", async function() {
        assert(await math.calcSingleOutGivenIn(web3.utils.toWei("1000"),web3.utils.toWei("10"),web3.utils.toWei("1"),0,true) == web3.utils.toWei("190"), "single out should be correct")
    });
    it("btoi()", async function() {
        assert( await math.btoi(web3.utils.toWei("55")) == 55,"btoi should work")
    });
    it("bfloor()", async function() {
        assert( await math.bfloor(web3.utils.toWei("55.5")) == web3.utils.toWei("55"),"bfloor should work")
    });
    it("bpowi()", async function() {
        assert(await math.bpowi(web3.utils.toWei("2"),2) == web3.utils.toWei("4"), "bpowi should be correct")
    });
    it("bpow()", async function() {
        assert(await math.bpow(web3.utils.toWei("1.5"),web3.utils.toWei("2")) == web3.utils.toWei("2.25"), "bpow should be correct")
    });
    it("bpowApprox()", async function() {
        assert(await math.bpowApprox(web3.utils.toWei("1.5"),web3.utils.toWei("2"),1) == web3.utils.toWei("2.25"), "bpow should be correct")
    });
    it("bsubSign()", async function() {
        let mvar = await math.bsubSign(4,2)
        assert(mvar[0] == 2, "bsubSign should work")
        assert(!mvar[1], "should be positive")
        mvar = await math.bsubSign(2,5)
        assert(mvar[0] == 3, "bsubSign should work")
        assert(mvar[1], "should be negative")
    });
    it("bmul()", async function() {
        assert(await math.bmul(web3.utils.toWei("2"),2) == 4, "bmul should work")
    });
    it("bdiv()", async function() {
        assert(await math.bdiv(web3.utils.toWei("4"),web3.utils.toWei("2")) == web3.utils.toWei("2"), "bdiv should work")
    });
    console.log("Oracle.sol -- to write")
    it("constructor()", async function() {
        assert(await oracle.tellor() == tellor.address, "tellor contract should be set properly")
    });
    it("getCommitment()", async function(){
        let ABI = ["function getOracleSubmission(uint256 _depositId)"];
        let iface = new ethers.utils.Interface(ABI);
        let funcSelector = iface.encodeFunctionData("getOracleSubmission", [1])
        
        _queryData = abiCoder.encode(
        ['string', 'bytes'],
        ['EVMCall', abiCoder.encode(
            ['uint256','address','bytes'],
            [1,accounts[1].address,funcSelector]
        )]
        );
        let _queryId = h.hash(_queryData)
        let _value = 100
        await tellor.connect(accounts[1]).submitValue(_queryId, _value,0, _queryData);
        await h.advanceTime(86400)
        let vals = await oracle.getCommitment(1,accounts[1].address,1)
        assert(vals[0] == 100, "value should be correct")
        assert(vals[1] == accounts[1].address, "reporter should be correct")
    })
    it("constructor()", async function() {
        console.log("CHD.sol")
        assert(await chd.charon() == accounts[1].address, "charon should be set")
    });
    it("burn() and mint()", async function() {
        await chd.connect(accounts[1]).mintCHD(accounts[2].address,web3.utils.toWei("100"))
        assert(await chd.balanceOf(accounts[2].address) == web3.utils.toWei("100"), "mint should work")
        await expect(chd.connect(accounts[3]).burnCHD(accounts[2].address,web3.utils.toWei("10"))).to.be.reverted;
        await chd.connect(accounts[1]).burnCHD(accounts[2].address,web3.utils.toWei("50"))
        assert(await chd.balanceOf(accounts[2].address) == web3.utils.toWei("50"), "burn should work")
        await expect(chd.connect(accounts[3]).mintCHD(accounts[3].address,web3.utils.toWei("10"))).to.be.reverted;
    });
    console.log("Verifier16.sol -- to write")
    it("constructor()", async function() {
    });
    console.log("Verifier2.sol -- to write")
    it("constructor()", async function() {
    });
});

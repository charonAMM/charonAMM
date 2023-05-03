const { expect, assert } = require("chai");
const { ethers } = require("hardhat");
const web3 = require('web3');
const h = require("usingtellor/test/helpers/helpers.js");
const abiCoder = new ethers.utils.AbiCoder()
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")

describe("charon system - bridge tests", function() {

    async function deploy(contractName, ...args) {
        const Factory = await ethers.getContractFactory(contractName)
        const instance = await Factory.deploy(...args)
        return instance.deployed()
      }

    let tellorBridge, gnosisAMB, p2e, e2p ,tellor;
    beforeEach(async function () {
        accounts = await ethers.getSigners();
        token = await deploy("MockERC20",accounts[1].address,"mock token", "MT");
        math = await deploy("MockMath")
        let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor = await TellorOracle.deploy();
        await tellor.deployed();
        chd = await deploy("CHD",accounts[1].address,"testchd","tc")
        mockNative = await deploy("MockNativeBridge")
        tellorBridge = await deploy("TellorBridge", tellor.address)
        gnosisAMB = await deploy("GnosisAMB", mockNative.address, tellor.address)
        p2e = await deploy("MockPOLtoETHBridge", tellor.address, mockNative.address)
        e2p = await deploy("MockETHtoPOLBridge", tellor.address,mockNative.address, mockNative.address)
        await mockNative.setUsers(gnosisAMB.address, p2e.address, e2p.address)
    });
    it("constructor() -e2p", async function() {
        assert(await e2p.tellor() == tellor.address, "tellor addy should be set")
        assert(await e2p.checkpointManager() == mockNative.address, "checkpointManager should be set")
        assert(await e2p.fxRoot() == mockNative.address, "fxRoot should be set")
    });
    it("setCharon() - e2p", async function() {
        await e2p.setCharon(accounts[1].address)
        assert(await e2p.charon() == accounts[1].address, "charon addy should be set")
        await h.expectThrow(e2p.setCharon(accounts[2].address))
    });
    it("setFxChildTunnel() - e2p", async function() {
        await e2p.setFxChildTunnel(accounts[1].address)
        assert(await e2p.fxChildTunnel() == accounts[1].address, "charon addy should be set")
        await h.expectThrow(e2p.setFxChildTunnel(accounts[2].address))
    });
    it("getCommitment() - e2p", async function() {
        await e2p.setCharon(accounts[1].address)
        await e2p.setFxChildTunnel(mockNative.address)
        let _data = h.hash("myData")
        await h.expectThrow(e2p.getCommitment(_data))//must be charon
        let val = await e2p.connect(accounts[1]).getCommitment(_data);
        assert(val[0] == _data, "should be _data, getCommitment, p2e")
        assert(val[1] == "0x0000000000000000000000000000000000000000", "should be zero addy")
    });
    it("sendCommitment() - e2p", async function() {
        await e2p.setCharon(accounts[1].address)
        await e2p.setFxChildTunnel(mockNative.address)
        let _data = h.hash("myData")
        await h.expectThrow(e2p.sendCommitment(_data))
        await e2p.connect(accounts[1]).sendCommitment(_data)
        let blockNumber = await ethers.provider.getBlockNumber();
        assert(await mockNative.lastBlock() > 0, "new block should be there")
        let _rData = await p2e.stateIdToData(blockNumber)
        assert(_rData == _data, "push should work")
    });
    it("constructor() - p2e", async function() {
        assert(await p2e.tellor() == tellor.address, "tellor addy should be set")
        assert(await p2e.fxChild() == mockNative.address, "fxChildshould be set")
    });
    it("setCharon() - p2e", async function() {
        await p2e.setCharon(accounts[1].address)
        assert(await p2e.charon() == accounts[1].address, "charon addy should be set")
        await h.expectThrow(p2e.setCharon(accounts[2].address))
    });
    it("_processMessageFromRoot() - p2e", async function() {
        await e2p.setCharon(accounts[1].address)
        await e2p.setFxChildTunnel(mockNative.address)
        await p2e.setCharon(accounts[1].address)
        let _data = h.hash("myData")
        await h.expectThrow(e2p.sendCommitment(_data))
        await e2p.connect(accounts[1]).sendCommitment(_data)
        let blockNumber = await ethers.provider.getBlockNumber();
        assert(await p2e.latestStateId() == blockNumber, "latest stateID should be right")
        let vars = await p2e.getStateIds()
        assert(vars[0] == blockNumber, 'stateID array getter should work')
        assert(await p2e.latestRootMessageSender() == mockNative.address, "root message sender should be correct")
        let _rData = await p2e.stateIdToData(blockNumber)
        assert(_rData == _data, "push should work")
    });
    it("getCommitment() - p2e", async function() {
        await e2p.setCharon(accounts[1].address)
        await e2p.setFxChildTunnel(mockNative.address)
        await p2e.setCharon(accounts[1].address)
        let _data = h.hash("myData")
        await h.expectThrow(e2p.sendCommitment(_data))
        await e2p.connect(accounts[1]).sendCommitment(_data)
        let blockNumber = await ethers.provider.getBlockNumber();
        await h.expectThrow(p2e.getCommitment(blockNumber))//must be charon
        let val = await p2e.connect(accounts[1]).callStatic.getCommitment(blockNumber)
        assert(val[0] == _data, "should be _data, getCommitment, p2e")
        assert(val[1] == "0x0000000000000000000000000000000000000000", "should be zero addy")
    });
    it("sendCommitment() - p2e", async function() {
        await e2p.setCharon(accounts[1].address)
        await e2p.setFxChildTunnel(accounts[1].address)
        await p2e.setCharon(accounts[1].address)
        let _data = h.hash("myData")
        await h.expectThrow(p2e.sendCommitment(_data))//must be charon
        await p2e.connect(accounts[1]).sendCommitment(_data)
    });
    it("constructor() - TellorBridge", async function() {
        assert(await tellorBridge.tellor() == tellor.address, "tellor should be set")
    });
    it("setPartnerInfo() - TellorBridge", async function() {
        await tellorBridge.setPartnerInfo(accounts[1].address, 1);
        assert(await tellorBridge.charon() == accounts[1].address, "charon must be set")
        assert(await tellorBridge.connectedChainId() == 1, "connected chain ID should be set");
    });
    it("getCommitment() - TellorBridge", async function() {
        //need to mock this one
        //assert onlyCharon
        let depositId = 1;
        _query = await getTellorData(tellor,accounts[3].address,1,depositId);
        let _data = h.hash("myData")
        _evmEncoded = await ethers.utils.AbiCoder.prototype.encode(['bytes','uint256'],[await ethers.utils.AbiCoder.prototype.encode(['bytes'],[_data]), 123456]);
        await tellor.connect(accounts[2]).submitValue(_query.queryId, _evmEncoded,_query.nonce, _query.queryData);
        await h.advanceTime(86400)//wait 12 hours
        _encoded = await ethers.utils.AbiCoder.prototype.encode(['uint256'],[depositId]);
        await h.expectThrow(tellorBridge.getCommitment(_encoded))
        await tellorBridge.setPartnerInfo(accounts[3].address, 1);
        let val = await tellorBridge.connect(accounts[1]).getCommitment(_encoded)
        assert(val[0] == _data, "should be _data, getCommitment, p2e")
        assert(val[1] == accounts[2].address, "should be zero addy")
    });
    it("sendCommitment() - TellorBridge", async function() {
        let _data = h.hash("myData")
        await tellorBridge.sendCommitment(_data)
        //don't need to assert anything, just a place holder
    });
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
});

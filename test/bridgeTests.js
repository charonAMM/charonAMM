// const { expect, assert } = require("chai");
// const { ethers } = require("hardhat");
// const web3 = require('web3');
// const h = require("usingtellor/test/helpers/helpers.js");
// const abiCoder = new ethers.utils.AbiCoder()
// const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")

// describe("charon system - bridge tests", function() {

//     async function deploy(contractName, ...args) {
//         const Factory = await ethers.getContractFactory(contractName)
//         const instance = await Factory.deploy(...args)
//         return instance.deployed()
//       }

//     let token,math,chd,oracle,tellor;
//     beforeEach(async function () {
//         accounts = await ethers.getSigners();
//         token = await deploy("MockERC20",accounts[1].address,"mock token", "MT");
//         math = await deploy("MockMath")
//         let TellorOracle = await ethers.getContractFactory(abi, bytecode);
//         tellor = await TellorOracle.deploy();
//         await tellor.deployed();
//         chd = await deploy("CHD",accounts[1].address,"testchd","tc")
//         mockNative = await deploy("MockNativeBridge")
//         gnosisAMB = await deploy("GnosisAMB", mockNative.address, tellor.address)
//         p2e = await deploy("MockPOLtoETHBridge", tellor.address, mockNative.address)
//         e2p = await deploy("MockETHtoPOLBridge", tellor.address,mockNative.address, mockNative.address)
//         await e2p.setFxChildTunnel(mockNative.address)
//         await mockNative.setUsers(gnosisAMB.address, p2e.address, e2p.address)
//     });
//     it("constructor()", async function() {
//         console.log("ETHtoPOLBridge.sol")
//             assert(await e2p.tellor() == tellor.address, "tellor addy should be set")
//             assert(await e2p.fxChildTunnel() == mockNative.address, "fxChildTunnel should be set")
//     });
//     it("setCharon()", async function() {
//         await e2p.setCharon(accounts[1].address)
//         assert(await e2p.charon() == accounts[1].address, "charon addy should be set")
//         await h.expectThrow(e2p.setCharon(accounts[2].address))
//     });
//     it("setFxChildTunnel()", async function() {
//         await e2p.setFxChildTunnel(accounts[1].address)
//         assert(await e2p.fxChildTunnel() == accounts[1].address, "charon addy should be set")
//         await h.expectThrow(e2p.etFxChildTunnel(accounts[2].address))
//     });

//     it("getCommitment()", async function() {
//         //need to mock this one
//         //assert onlyCharon
//         mock get back message and addy 0
//     });
//     it("sendCommitment()", async function() {
//         //need to mock this one
//         //assert onlyCharon, calls sendCommitment on mock
//     });


//     it("constructor()", async function() {
//         console.log("POLtoETHBridge.sol")
//         assert(await p2e.tellor() == tellor.address, "tellor addy should be set")
//         assert(await p2e.fxChild() == mockNative.address, "fxChildshould be set")
//     });
//     it("setCharon()", async function() {
//         await p2e.setCharon(accounts[1].address)
//         assert(await p2e.charon() == accounts[1].address, "charon addy should be set")
//         await h.expectThrow(p2e.setCharon(accounts[2].address))
//     });
//     it("_processMessageFromRoot()", async function() {
//         //mock it up
//         //store all variables properly
//     });
//     it("getCommitment()", async function() {
//         //need to mock this one
//         //assert onlyCharon
//         mock get back message and addy 0
//     });
//     it("sendCommitment()", async function() {
//         //need to mock this one
//         //assert onlyCharon, calls sendCommitment on mock
//     });
//     it("getStateIds()", async function() {
//         //need to mock this one
//         //assert onlyCharon, calls sendCommitment on mock
//         let vars = p2e.getStateIds();
//         assert(vars[0] == myStateId, "stateId should be correct")
//     });


//     it("constructor()", async function() {
//         console.log("TellorBridge.sol")
//             assert(await token.name() == "mock token")
//             assert(await token.symbol() == "MT")
//     });
//     it("setPartnerInfo()", async function() {
//             assert(await tellorBridge.charon() == accounts[1].address "mock token")
//             assert(await tellorBridge.connectedChainId == 1);
//     });
//     it("getCommitment()", async function() {
//         //need to mock this one
//         //assert onlyCharon
//         mock get back message and addy 0
//     });
//     it("sendCommitment()", async function() {
//         //need to mock this one
//         //assert onlyCharon, calls sendCommitment on mock
//     });

// });

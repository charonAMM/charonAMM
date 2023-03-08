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
//             assert(await token.name() == "mock token")
//             assert(await token.symbol() == "MT")
//     });
//     it("constructor()", async function() {
//         console.log("POLtoETHBridge.sol")
//             assert(await token.name() == "mock token")
//             assert(await token.symbol() == "MT")
//     });
//     it("constructor()", async function() {
//         console.log("TellorBridge.sol")
//             assert(await token.name() == "mock token")
//             assert(await token.symbol() == "MT")
//     });
// });

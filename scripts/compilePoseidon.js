// Generates Hasher artifact at compile-time using external compilermechanism
const path = require('path')
const fs = require('fs')
//const genContract = require('circomlib/src/poseidon_gencontract.js')
const { poseidonContract } = require("circomlibjs");
const outputPath = path.join(__dirname, '..', 'build')
const outputFile = path.join(outputPath, 'Hasher.json')
const abiJson = poseidonContract.generateABI(2);
const myBytecode = poseidonContract.createCode(2);

if (!fs.existsSync(outputPath)) {
  fs.mkdirSync(outputPath, { recursive: true })
}


const contract = {
  _format: 'hh-sol-artifact-1',
  sourceName: 'contracts/Hasher.sol',
  linkReferences: {},
  deployedLinkReferences: {},
  contractName: 'Hasher',
  abi: abiJson,
  bytecode: myBytecode,
}

fs.writeFileSync(outputFile, JSON.stringify(contract, null, 2))

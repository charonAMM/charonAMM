const MerkleTree = require('fixed-merkle-tree')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { toFixedHex, poseidonHash2, getExtDataHash, FIELD_SIZE, shuffle } = require('./utils')
const Utxo = require('./utxo')
const zero = "21663839004416932945382355908790599225266501822907911457504978515578255421292"
const { prove } = require('./prover')
const MERKLE_TREE_HEIGHT = 23

async function buildMerkleTree(charon, hasherFunc) {
  let filter = charon.filters.NewCommitment()
  const events = await charon.queryFilter(filter, 0 , "latest")
  //console.log(events)
  const leaves = events.sort((a, b) => a.args._index - b.args._index).map((e) => toFixedHex(e.args._commitment))
  let tree = await new MerkleTree.default(MERKLE_TREE_HEIGHT,[], { hashFunction: hasherFunc, zeroElement: zero })
  await tree.bulkInsert(leaves)
  return tree
  //return new MerkleTree(MERKLE_TREE_HEIGHT, leaves, { hashFunction: poseidonHash2 })
}

async function getProof({
  inputs,
  outputs,
  tree,
  extAmount,
  fee,
  rebate,
  recipient,
  privateChainID,
  myHasherFunc,
  test
}) {
  inputs = shuffle(inputs)
  outputs = shuffle(outputs)

  let inputMerklePathIndices = []
  let inputMerklePathElements = []

  for (const input of inputs) {
    if (input.amount > 0) {
      input.index = tree.indexOf(toFixedHex(input.getCommitment(myHasherFunc)))
      if(test){
        input.index = 1
      }
      if (input.index < 0) {
        throw new Error(`Input commitment ${toFixedHex(input.getCommitment(myHasherFunc))} was not found`)
      }
      inputMerklePathIndices.push(input.index)
      try{
        inputMerklePathElements.push(tree.path(input.index).pathElements)
      }
      catch{
        if(test){
          inputMerklePathElements.push(new Array(tree.levels).fill(0))
        }
        else{
          throw new Error("index out of bounds")
        }
      }
    } else {
      inputMerklePathIndices.push(0)
      inputMerklePathElements.push(new Array(tree.levels).fill(0))
    }
  }

  const extData = {
    recipient: toFixedHex(recipient, 20),
    extAmount: toFixedHex(extAmount),
    fee: toFixedHex(fee),
    rebate: toFixedHex(rebate),
    encryptedOutput1: outputs[0].encrypt(),
    encryptedOutput2: outputs[1].encrypt()
  }

  const extDataHash = getExtDataHash(extData)
  let input = {
    root: await tree.root,
    chainID: privateChainID,
    publicAmount: BigNumber.from(extAmount).sub(fee).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
    extDataHash: extDataHash,
    inputNullifier: await Promise.all(inputs.map((x) => x.getNullifier(myHasherFunc))),
    outputCommitment: await Promise.all(outputs.map((x) => x.getCommitment(myHasherFunc))),

    // data for 2 transaction inputs
    privateChainID: privateChainID,
    inAmount: inputs.map((x) => x.amount),
    inPrivateKey: inputs.map((x) => x.keypair.privkey),
    inBlinding: inputs.map((x) => x.blinding),
    inPathIndices: inputMerklePathIndices,
    inPathElements: inputMerklePathElements,

    // data for 2 transaction outputs
    outAmount: outputs.map((x) => x.amount),
    outBlinding: outputs.map((x) => x.blinding),
    outPubkey: await Promise.all(outputs.map((x) => x.keypair.pubkey)),
  }

  let proof
  if(test){
    proof = "0x05d9ab35de0c1cd660c35fc200b347ccb62137b3a5c76863efaf747ccaac93b50ca82593e48eb2999a15d0f324c427e23fb5765e35198322bf90bb024df504ca10b994e4697566004b88f8c116aa59a051d5bbf8c0c3badc46e51532c01c051a02dbaeaba0f9362a8994d9bb6de0de72c2fd5b2d947b4328825a2a42e81732a91f37e1e7a796cd3cb0aac043e6f24052a371ea7404c3d7808dbf52709d59c82e008ec50f2a54baa4f6bd404d8bbcdd0b45418a5fd629278c8c3c1b7a8da604e62a1593ba48be71f14c07146b838647cd1d3e029ea06c8375495ac295fda5150403510cc1c11e2c726ce767727e0c90c2f7270ed0f61791d70d5f7de61228210b"
  }
  else {
    proof = await prove(input, `./artifacts/circuits/transaction${inputs.length}_js/transaction${inputs.length}`, `./artifacts/circuits//transaction${inputs.length}`)
  }
  
  const args = {
    proof,
    root: toFixedHex(input.root),
    inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
    outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment())),
    publicAmount: toFixedHex(input.publicAmount),
    extDataHash: toFixedHex(extDataHash),
  }
  return {
    extData,
    args,
  }
}

async function prepareTransaction({
  charon,
  inputs = [],
  outputs = [],
  fee = 0,
  recipient = 0,
  rebate = 0,
  privateChainID = 2,
  myHasherFunc,
  myHasherFunc2,
  test = false
}) {
  if (inputs.length > 16 || outputs.length > 2) {
    throw new Error('Incorrect inputs/outputs count')
  }
  while (inputs.length !== 2 && inputs.length < 16) {
    inputs.push(new Utxo({myHashFunc:myHasherFunc, chainID: privateChainID}))
  }
  while (outputs.length < 2) {
    outputs.push(new Utxo({myHashFunc:myHasherFunc, chainID: privateChainID}))
  }
  let extAmount = BigNumber.from(fee)
    .add(outputs.reduce((sum, x) => sum.add(x.amount), BigNumber.from(0)))
    .sub(inputs.reduce((sum, x) => sum.add(x.amount), BigNumber.from(0)))

  const { args, extData } = await getProof({
    inputs,
    outputs,
    tree: await buildMerkleTree(charon, myHasherFunc2),
    extAmount,
    fee,
    rebate,
    recipient,
    privateChainID,
    myHasherFunc,
    test
  })

  return {
    args,
    extData,
  }
}

async function transaction({ charon, ...rest }) {
  const { args, extData } = await prepareTransaction({
    charon,
    ...rest,
  })

  const receipt = await charon.transact(args, extData, {
    gasLimit: 2e6,
  })
  return await receipt.wait()
}

async function registerAndTransact({ charon, account, ...rest }) {
  const { args, extData } = await prepareTransaction({
    charon,
    ...rest,
  })

  const receipt = await charon.registerAndTransact(account, args, extData, {
    gasLimit: 2e6,
  })
  await receipt.wait()
}

module.exports = { transaction, registerAndTransact, prepareTransaction, buildMerkleTree }

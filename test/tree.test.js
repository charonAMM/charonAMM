const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect, assert } = require('chai')
const HASH = require("../build/Hasher.json")
const { toFixedHex } = require('../src/utils')
const { buildPoseidon } = require("circomlibjs");


const MERKLE_TREE_HEIGHT = 5
const MerkleTree = require('fixed-merkle-tree')


describe('MerkleTreeWithHistory', function () {
  this.timeout(20000)
  let poseidon, hasher, merkleTreeWithHistory;
  let zero = "21663839004416932945382355908790599225266501822907911457504978515578255421292"
  beforeEach(async function () {
    poseidon = await buildPoseidon()
    let Hasher = await ethers.getContractFactory(HASH.abi, HASH.bytecode);
    hasher = await Hasher.deploy();
    merkleTreeWithHistory = await deploy(
      'MerkleTreeWithHistoryMock',
      MERKLE_TREE_HEIGHT,
      hasher.address,
    )
    await merkleTreeWithHistory.initialize()
  })
  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  function poseidonHash2(a,b){
    let val = poseidon([a,b])
    return poseidon.F.toString(val)
  }

  function getNewTree() {
    return new MerkleTree.default(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2, zeroElement: zero })
  }
  describe('#constructor', () => {
    it('should correctly hash 2 leaves', async () => {
      //console.log(hasher)
      const hash0 = await merkleTreeWithHistory.hashLeftRight(toFixedHex(123), toFixedHex(456))
      // const hash1 = await hasher.poseidon([123, 456])
      const hash2 = await poseidonHash2(123, 456)
      assert(hash0 - hash2 == 0, "should be the same hash");
    })

    it('should initialize', async () => {
      const zeroValue = await merkleTreeWithHistory.ZERO_VALUE()
      const firstSubtree = await merkleTreeWithHistory.filledSubtrees(0)
      const firstZero = await merkleTreeWithHistory.getZeros(0)
      assert(await merkleTreeWithHistory.hasher() == hasher.address, "hasher should be set")
      assert(await merkleTreeWithHistory.levels() == MERKLE_TREE_HEIGHT, "height should be set")
      expect(firstSubtree).to.be.equal(zeroValue)
      expect(firstZero).to.be.equal(zeroValue)
      await expect(merkleTreeWithHistory.initialize()).to.be.reverted;
    })

    it('should have correct merkle root', async () => {
      const tree = await getNewTree()
      const contractRoot = await merkleTreeWithHistory.getLastRoot()
      let root = await tree.root
      //expect(root).to.equal(contractRoot)
      assert(tree.zeroElement - zero == 0, "zero should be the same")
      assert(root - contractRoot == 0, "should have correct merkle root")
    })
  })
  describe('#insert', () => {
    it('should insert', async () => {
      const tree = await getNewTree()
      await merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
      tree.bulkInsert([123, 456])
      assert(await merkleTreeWithHistory.getLastRoot() - tree.root == 0, "should be same insert" )
      //expect(tree.root).to.be.be.equal(await merkleTreeWithHistory.getLastRoot())
      await merkleTreeWithHistory.insert(toFixedHex(678), toFixedHex(876))
      tree.bulkInsert([678, 876])
      assert(await merkleTreeWithHistory.getLastRoot() == toFixedHex(tree.root), "root should be the same insert")
      //expect(tree.root).to.be.be.equal(await merkleTreeWithHistory.getLastRoot())
    })
    it('hasher gas', async () => {
      const gas = await merkleTreeWithHistory.estimateGas.hashLeftRight(toFixedHex(123), toFixedHex(456))
      console.log('hasher gas', gas - 21000)
    })
  })
  describe('#isKnownRoot', () => {

    it('should return last root', async () => {
      await merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
      const tree = await getNewTree()
      tree.bulkInsert([123, 456])
      expect(await merkleTreeWithHistory.isKnownRoot(toFixedHex(tree.root))).to.equal(true)
    })
    it('should return older root', async () => {
      await merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
      const tree = getNewTree()
      tree.bulkInsert([123, 456])
      await merkleTreeWithHistory.insert(toFixedHex(234), toFixedHex(432))
      expect(await merkleTreeWithHistory.isKnownRoot(toFixedHex(tree.root))).to.equal(true)
    })
    it('should fail on unknown root', async () => {
      await merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
      const tree = getNewTree()
      tree.bulkInsert([456, 654])
      let root = await tree.root
      expect(await merkleTreeWithHistory.isKnownRoot(toFixedHex(root))).to.equal(false)
    })
    it('should not return uninitialized roots', async () => {
      await merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
      expect(await merkleTreeWithHistory.isKnownRoot(toFixedHex(0))).to.equal(false)
    })
  })
})

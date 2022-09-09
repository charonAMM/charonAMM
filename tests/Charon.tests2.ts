import { assert, expect } from "chai";
import { Verifier__factory, Hasher__factory } from "../types";
const { ethers } = require("hardhat");
const { utils } = require('ffjavascript')
import { Contract, ContractFactory, BigNumber, BigNumberish } from "ethers";
const { Keypair } = require('./helpers/keypair')
// @ts-ignore
import { poseidonContract, buildPoseidon } from "circomlibjs";
// @ts-ignore
import { MerkleTree, Hasher } from "../src/merkleTree";
// @ts-ignore
import { groth16, bigInt } from "snarkjs";
import path from "path";
const { transaction, prepareTransaction, getLeaves } = require('./helpers/index')
const { poseidonHash2 } = require('./helpers/utils')
const Utxo = require('./helpers/utxo')
const h = require("usingtellor/test/helpers/helpers.js");
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")
const web3 = require('web3');

const ETH_AMOUNT = ethers.utils.parseEther("1");
const HEIGHT = 5;

function sleep(ms:any) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

function poseidonHash(poseidon: any, inputs: BigNumberish[]): string {
    const hash = poseidon(inputs.map((x) => BigNumber.from(x).toBigInt()));
    const hashStr = poseidon.F.toString(hash);
    const hashHex = BigNumber.from(hashStr).toHexString();
    return ethers.utils.hexZeroPad(hashHex, 32);
}

function getTellorSubmission(args: any, extData: any){
  const abiCoder = new ethers.utils.AbiCoder()
  const dataEncoded = abiCoder.encode(
    ['uint256[2]','uint256[2][2]','uint256[2]','uint256','bytes32','uint256','bytes32[]','bytes32[2]','address','int256','address','uint256'],
    [
      args.a,
      args.b,
      args.c,
      args.publicAmount,
      args.root,
      args.extDataHash,
      args.inputNullifiers,
      args.outputCommitments,
      extData.recipient,
      extData.extAmount,
      extData.relayer,
      extData.fee
    ]
  );
  return dataEncoded;
}
function getExtDataHash(recipient: any,extAmount:any ,relayer: any,fee: any, fsize:any) {
    const abiCoder = new ethers.utils.AbiCoder()
    const encodedData = abiCoder.encode(
      ['tuple(address recipient,int256 extAmount,address relayer,uint256 fee)',],
      [{
          recipient: toFixedHex(recipient, 20),
          extAmount: extAmount,
          relayer: toFixedHex(relayer, 20),
          fee: toFixedHex(fee),
        },],
    )
    const hash = ethers.utils.keccak256(encodedData)
    return BigNumber.from(hash).mod(fsize)
  }

class PoseidonHasher implements Hasher {
    poseidon: any;
    constructor(poseidon: any) {
        this.poseidon = poseidon;
    }
    hash(left: string, right: string) {
        return poseidonHash(this.poseidon, [left, right]);
    }
}

class Deposit {
    private constructor(
        public readonly nullifier: Uint8Array,
        public poseidon: any,
        public leafIndex?: number
    ) {
        this.poseidon = poseidon;
    }
    static new(poseidon: any) {
        const nullifier = ethers.utils.randomBytes(15);
        return new this(nullifier, poseidon);
    }
    get commitment() {
        return poseidonHash(this.poseidon, [this.nullifier, 0]);
    }
    get nullifierHash() {
        if (!this.leafIndex && this.leafIndex !== 0)
            throw Error("leafIndex is unset yet");
        return poseidonHash(this.poseidon, [this.nullifier, 1, this.leafIndex]);
    }
}

interface Proof {
    a: [BigNumberish, BigNumberish];
    b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]];
    c: [BigNumberish, BigNumberish];
}

async function buildLeaves(charonInstance:any, thisTree:any){
  const filter = charonInstance.filters.NewCommitment()
  const events = await charonInstance.queryFilter(filter, 0)
  //@ts-ignore
  const leaves = events.sort((a, b) => a.args.index - b.args.index).map((e) => toFixedHex(e.args.commitment))
  for(var i = 0; i < leaves.length; i ++ ){
    thisTree.insert(leaves[i])
  }
}

async function prove(witness: any): Promise<Proof> {
    const wasmPath = path.join(__dirname, "../build/transaction_js/transaction.wasm");
    const zkeyPath = path.join(__dirname, "../build/circuit_final.zkey");
    const { proof } = await groth16.fullProve(witness, wasmPath, zkeyPath);
    const solProof: Proof = {
        a: [proof.pi_a[0], proof.pi_a[1]],
        b: [
            [proof.pi_b[0][1], proof.pi_b[0][0]],
            [proof.pi_b[1][1], proof.pi_b[1][0]],
        ],
        c: [proof.pi_c[0], proof.pi_c[1]],
    };
    return solProof;
}

//@ts-ignore
const toFixedHex = (number, length = 32) => (number.toString(16).padStart(2, '0'))

describe("Charon tests 2", function () {
    let poseidon: any;
    let hasher: Contract;
    let charon: Contract;
    let charon2: Contract;
    let tellor: Contract;
    let tellor2: Contract;
    let verifier: Contract;
    let accounts: any;
    let cfac: any;
    let tfac: any;
    let chd: Contract;
    let chd2: Contract;
    let token: Contract;
    let token2: Contract;
    let abiCoder = new ethers.utils.AbiCoder();
    let fee = 0;
    let queryId: any;
    let inputs: any[]
    let outputs: any[]
    let FIELD_SIZE: any;

    before(async () => {
        poseidon = await buildPoseidon();
    });
    beforeEach(async function () {
        accounts = await ethers.getSigners();
            //deploy mock token
        tfac = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
        token = await tfac.deploy(accounts[1].address,"Dissapearing Space Monkey","DSM");
        await token.deployed();
        verifier = await new Verifier__factory(accounts[0]).deploy();
        await verifier.deployed()
        let Pbytecode = poseidonContract.createCode(2);
        let PabiJson = poseidonContract.generateABI(2);
        let pfc =  await ethers.getContractFactory(PabiJson, Pbytecode);
        hasher = await pfc.deploy()
        await hasher.deployed()
        await token.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        //deploy tellor
        let TellorOracle = await ethers.getContractFactory(abi, bytecode);
        tellor = await TellorOracle.deploy();
        await tellor.deployed();
        cfac = await ethers.getContractFactory("contracts/Charon.sol:Charon");
        charon = await cfac.deploy(verifier.address,hasher.address,token.address,fee,tellor.address,HEIGHT,1,"Charon Pool Token","CPT");
        await charon.deployed();
        FIELD_SIZE = await charon.FIELD_SIZE() 
        //now deploy on other chain (same chain, but we pretend w/ oracles)
        token2 = await tfac.deploy(accounts[1].address,"Dissapearing Space Monkey2","DSM2");
        await token2.deployed();
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        tellor2 = await TellorOracle.deploy();
        await tellor2.deployed();
        charon2 = await cfac.deploy(verifier.address,hasher.address,token2.address,fee,tellor2.address,HEIGHT,2,"Charon Pool Token","CPT");
        await charon2.deployed();
        chd = await tfac.deploy(charon.address,"Charon Dollar","chd")
        chd2 = await tfac.deploy(charon2.address,"Charon Dollar","chd")
        //now set both of them. 
        await token.approve(charon.address,web3.utils.toWei("100"))//100
        await token2.approve(charon2.address,web3.utils.toWei("100"))//100
        await charon.finalize([2],[charon2.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address);
        await charon2.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd2.address);
    });
    // it("generates same poseidon hash", async function () {
    //     const res = await hasher["poseidon(uint256[2])"]([1, 2]);
    //     const res2 = poseidon([1, 2]);
    //     assert.equal(res.toString(), poseidon.F.toString(res2));
    // }).timeout(500000);
    // it("Test Constructor", async function() {
    //     assert(await charon.tellor() == tellor.address, "oracle  address should be set")
    //     assert(await charon.levels() == HEIGHT, "merkle Tree height should be set")
    //     assert(await charon.hasher() == hasher.address, "hasher should be set")
    //     assert(await charon.verifier() == verifier.address, "verifier should be set")
    //     assert(await charon.token() == token.address, "token should be set")
    //     assert(await charon.fee() == fee, "fee should be set")
    //     assert(await charon.controller() == accounts[0].address, "controller should be set")
    //     assert(await charon.chainID() == 1, "chainID should be correct")
    //   });
    //   it("Test changeController", async function() {
    //     await charon.changeController(accounts[1].address)
    //     assert(await charon.controller() == accounts[1].address, "controller should change")
    //   });
      it("Test depositToOtherChain", async function() {
        let deposit: any;
        let relayer: any;
        let extAmount:any;
        const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
                                                  web3.utils.toWei("1000"),
                                                  web3.utils.toWei("10"),
                                                  0)
        await token.connect(accounts[1]).approve(charon.address,_amount)
        deposit = Deposit.new(poseidon);
        let _chdOut = web3.utils.toWei("10")
        const aliceKeypair = await new Keypair() // contains private and public keys
        const aliceDepositUtxo = await new Utxo({ amount: _chdOut})//should this include alice's keypair?
        let addy = await aliceKeypair.pubkey
        const recipient = ethers.utils.getAddress(addy.slice(0,42))
        relayer = accounts[2].address
        //@ts-ignore
        let extDataHash = getExtDataHash(recipient,_chdOut,relayer,0,FIELD_SIZE)
        await buildLeaves(charon,tree)
        const { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
        //@ts-ignore
        inputs = []
        outputs = [aliceDepositUtxo]
        //@ts-ignore
        let outCommitments = []
        let outKeys = []
        let inNullifier = []
        if (inputs.length > 16 || outputs.length > 2) {
            throw new Error('Incorrect inputs/outputs count')
          }
          while (inputs.length !== 2 && inputs.length < 16) {
            inputs.push(new Utxo())
          }
          while (outputs.length < 2) {
            outputs.push(new Utxo())
          }
        for(var i = 0; i< outputs.length;i++){
          if (!outputs[i]._commitment) {
            outputs[i]._commitment = poseidonHash(deposit.poseidon,[outputs[i].amount,await outputs[i].keypair.pubkey, outputs[i].blinding])
          }
          outCommitments.push(outputs[i]._commitment)
          outKeys.push(await outputs[i].keypair.pubkey)
        }
        for(var i = 0; i< inputs.length;i++){
          if (!inputs[i]._nullifier) {
            if (
              inputs[i].amount > 0 &&
              (inputs[i].index === undefined ||
                inputs[i].index === null ||
                inputs[i].keypair.privkey === undefined ||
                inputs[i].keypair.privkey === null)
            ) {
              throw new Error('Can not compute nullifier without utxo index or private key')
            }
            inputs[i]._commitment  = poseidonHash(deposit.poseidon,[inputs[i].amount,await inputs[i].keypair.pubkey, inputs[i].blinding])
            const signature = inputs[i].keypair.privkey ? inputs[i].keypair.sign(inputs[i]._commitment, inputs[i].index || 0) : 0
            inputs[i]._nullifier = poseidonHash(deposit.poseidon,[inputs[i]._commitment, this.index || 0, await signature])
          }
          inNullifier.push(inputs[i]._nullifier)
        }
      
        let inputMerklePathIndices = []
        let inputMerklePathElements = []
      
        for (const input of inputs) {
          if (input.amount > 0) {
            input.index = tree.getIndexByElement(toFixedHex(input.getCommitment()))
            if (input.index < 0) {
              throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
            }
            inputMerklePathIndices.push(input.index)
            let myPath = await tree.path(input.index)
            inputMerklePathElements.push(myPath.path_elements)
          } else {
            inputMerklePathIndices.push(0)
            inputMerklePathElements.push(new Array(tree.n_levels).fill(0))
          }
        }
        const input = {
            // Public
            chainID: 2,
            root,
            publicAmount: BigNumber.from(_chdOut).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
            extDataHash: BigNumber.from(extDataHash).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
            inputNullifier: await inNullifier,
            outputCommitment: await outCommitments,
            privateChainID: 2,
            inAmount: await Promise.all(inputs.map(async (x) => await BigNumber.from(x.amount).toString())),
            inPrivateKey: await Promise.all(inputs.map(async (x) => await x.keypair.privkey)),
            inBlinding: await Promise.all(inputs.map(async (x) => await x.blinding)),
            inPathIndices: inputMerklePathIndices,
            inPathElements: inputMerklePathElements,
            outAmount: await Promise.all(outputs.map(async (x) => await BigNumber.from(x.amount).toString())),
            outBlinding: await Promise.all(outputs.map(async (x) => await x.blinding)),
            outPubkey: await Promise.all(outputs.map(async (x) => await x.keypair.pubkey))
        };
        const proof = await prove(input);
        const args = {
            a: proof.a,
            b: proof.b,
            c: proof.c,
            publicAmount: toFixedHex(input.publicAmount),
            root: toFixedHex(input.root),
            inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
            outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment())),
            extDataHash: extDataHash,
          }

        const extData = {
          recipient: toFixedHex(recipient, 20),
          extAmount: toFixedHex(BigNumber.from(_chdOut).toString()),
          relayer: toFixedHex(relayer, 20),
          fee: toFixedHex(0)
        }
        await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
        let commi = await charon.getDepositCommitmentsById(1);
        let num= BigNumber.from(args.extDataHash)
        assert(commi[1].a[0] == args.a[0], "commitment a should be stored")
        assert(commi[1].a[1] == args.a[1], "commitment a should be stored")
        assert(commi[1].b[0][0] == args.b[0][0], "commitment b should be stored")
        assert(commi[1].b[0][1] == args.b[0][1], "commitment b should be stored")
        assert(commi[1].b[1][0] == args.b[1][0], "commitment b should be stored")
        assert(commi[1].b[1][1] == args.b[1][1], "commitment b should be stored")
        assert(commi[1].c[0] == args.c[0], "commitment c should be stored")
        assert(commi[1].c[1] == args.c[1], "commitment c should be stored")
        assert(commi[1].publicAmount == args.publicAmount, "commitment publicAmount should be stored")
        assert(commi[1].root == args.root, "commitment root should be stored")
        assert(commi[1].inputNullifiers[0] == args.inputNullifiers[0], "commitment inputNullifiers should be stored")
        assert(commi[1].inputNullifiers[1] == args.inputNullifiers[1], "commitment inputNullifiers should be stored")
        assert(commi[1].outputCommitments[0] == args.outputCommitments[0], "commitment outputCommitments should be stored")
        assert(commi[1].outputCommitments[1] == args.outputCommitments[1], "commitment outputCommitments should be stored")
        assert(BigNumber.from(commi[1].extDataHash).sub(num).toNumber() == 0, "commitment extDataHash should be stored")
        assert(commi[0].recipient == extData.recipient, "extData should be correct");
        assert(commi[0].extAmount == extData.extAmount, "extData should be correct");
        assert(commi[0].relayer == extData.relayer, "extData should be correct");
        assert(BigNumber.from(commi[0].fee).toNumber() == extData.fee, "extData fee should be correct");
        const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
          ['uint256[2]', 'uint256[2][2]', 'uint256[2]','uint256','bytes32'],
          [args.a,[[args.b[0][0],args.b[0][1]],[args.b[1][0],args.b[1][1]]],[args.c[0],args.c[1]],args.publicAmount,args.root]
        );
        assert(await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded)) == 1, "reverse commitment mapping should work")
        assert(await charon.recordBalance() * 1 -(1* web3.utils.toWei("100") + 1 * _amount) == 0, "recordBalance should go up")
        assert(await token.balanceOf(accounts[1].address) == web3.utils.toWei("100") - _amount, "balance should change properly")
      });
      it("Test depositToOtherChain - CHD", async function() {
        await chd.mint(accounts[1].address,web3.utils.toWei("100"))
        let deposit: any;
        let relayer: any;
        let extAmount:any;
        const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        let _chdOut = web3.utils.toWei("10")
        deposit = Deposit.new(poseidon);
        const aliceKeypair = await new Keypair() // contains private and public keys
        const aliceDepositUtxo = await new Utxo({ amount: _chdOut})//should this include alice's keypair?
        let addy = await aliceKeypair.pubkey
        const recipient = ethers.utils.getAddress(addy.slice(0,42))
        relayer = accounts[2].address
        //@ts-ignore
        let extDataHash = getExtDataHash(recipient,_chdOut,relayer,0,FIELD_SIZE)
        await buildLeaves(charon,tree)
        const { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
        //@ts-ignore
        inputs = []
        outputs = [aliceDepositUtxo]
        //@ts-ignore
        let outCommitments = []
        let outKeys = []
        let inNullifier = []
        if (inputs.length > 16 || outputs.length > 2) {
            throw new Error('Incorrect inputs/outputs count')
          }
          while (inputs.length !== 2 && inputs.length < 16) {
            inputs.push(new Utxo())
          }
          while (outputs.length < 2) {
            outputs.push(new Utxo())
          }
        for(var i = 0; i< outputs.length;i++){
          if (!outputs[i]._commitment) {
            outputs[i]._commitment = poseidonHash(deposit.poseidon,[outputs[i].amount,await outputs[i].keypair.pubkey, outputs[i].blinding])
          }
          outCommitments.push(outputs[i]._commitment)
          outKeys.push(await outputs[i].keypair.pubkey)
        }
        for(var i = 0; i< inputs.length;i++){
          if (!inputs[i]._nullifier) {
            if (
              inputs[i].amount > 0 &&
              (inputs[i].index === undefined ||
                inputs[i].index === null ||
                inputs[i].keypair.privkey === undefined ||
                inputs[i].keypair.privkey === null)
            ) {
              throw new Error('Can not compute nullifier without utxo index or private key')
            }
            inputs[i]._commitment  = poseidonHash(deposit.poseidon,[inputs[i].amount,await inputs[i].keypair.pubkey, inputs[i].blinding])
            const signature = inputs[i].keypair.privkey ? inputs[i].keypair.sign(inputs[i]._commitment, inputs[i].index || 0) : 0
            inputs[i]._nullifier = poseidonHash(deposit.poseidon,[inputs[i]._commitment, this.index || 0, await signature])
          }
          inNullifier.push(inputs[i]._nullifier)
        }
        let inputMerklePathIndices = []
        let inputMerklePathElements = []
      
        for (const input of inputs) {
          if (input.amount > 0) {
            input.index = tree.getIndexByElement(toFixedHex(input.getCommitment()))
            if (input.index < 0) {
              throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
            }
            inputMerklePathIndices.push(input.index)
            let myPath = await tree.path(input.index)
            inputMerklePathElements.push(myPath.path_elements)
          } else {
            inputMerklePathIndices.push(0)
            inputMerklePathElements.push(new Array(tree.n_levels).fill(0))
          }
        }
        const input = {
            chainID: 2,
            root,
            publicAmount: BigNumber.from(_chdOut).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
            extDataHash: BigNumber.from(extDataHash).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
            inputNullifier: await inNullifier,
            outputCommitment: await outCommitments,
            privateChainID: 2,
            inAmount: await Promise.all(inputs.map(async (x) => await BigNumber.from(x.amount).toString())),
            inPrivateKey: await Promise.all(inputs.map(async (x) => await x.keypair.privkey)),
            inBlinding: await Promise.all(inputs.map(async (x) => await x.blinding)),
            inPathIndices: inputMerklePathIndices,
            inPathElements: inputMerklePathElements,
            outAmount: await Promise.all(outputs.map(async (x) => await BigNumber.from(x.amount).toString())),
            outBlinding: await Promise.all(outputs.map(async (x) => await x.blinding)),
            outPubkey: await Promise.all(outputs.map(async (x) => await x.keypair.pubkey))
        };
        const proof = await prove(input);
        const args = {
            a: proof.a,
            b: proof.b,
            c: proof.c,
            publicAmount: toFixedHex(input.publicAmount),
            root: toFixedHex(input.root),
            inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
            outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment())),
            extDataHash: extDataHash,
          }
        const extData = {
          recipient: toFixedHex(recipient, 20),
          extAmount: toFixedHex(BigNumber.from(_chdOut).toString()),
          relayer: toFixedHex(relayer, 20),
          fee: toFixedHex(0)
        }
        await charon.connect(accounts[1]).depositToOtherChain(args,extData,true);
        let commi = await charon.getDepositCommitmentsById(1);
        const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
          ['uint256[2]', 'uint256[2][2]', 'uint256[2]','uint256','bytes32'],
          [args.a,[[args.b[0][0],args.b[0][1]],[args.b[1][0],args.b[1][1]]],[args.c[0],args.c[1]],args.publicAmount,args.root]
        );
        assert(await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded)) == 1, "reverse commitment mapping should work")
        assert(await charon.recordBalanceSynth() * 1 -(1* web3.utils.toWei("1000")) == 0, "recordBalance should not go up")
        console.log(await chd.balanceOf(accounts[1].address) - (web3.utils.toWei("100") - _chdOut))
        assert(await chd.balanceOf(accounts[1].address) - (web3.utils.toWei("100") - _chdOut) == 0, "balance should change properly")
      });
      // it("Test finalize", async function() {
      //   let testCharon = await cfac.deploy(verifier.address,hasher.address,token2.address,fee,tellor2.address,HEIGHT,2,"Charon Pool Token","CPT");
      //   await testCharon.deployed();
      //   let chd3 = await tfac.deploy(testCharon.address,"Charon Dollar","chd")
      //   await token2.approve(testCharon.address,web3.utils.toWei("100"))//100
      //   await h.expectThrow(testCharon.connect(accounts[1]).finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address))//must be controller
      //   await testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd3.address);
      //   await h.expectThrow(testCharon.finalize([1],[charon.address],web3.utils.toWei("100"),web3.utils.toWei("1000"),chd.address))//already finalized
      //   assert(await testCharon.finalized(), "should be finalized")
      //   assert(await testCharon.balanceOf(accounts[0].address) - web3.utils.toWei("100") == 0, "should have full balance")
      //   let pC = await testCharon.getPartnerContracts();
      //   assert(pC[0][0] == 1, "partner chain should be correct")
      //   assert(pC[0][1] == charon.address, "partner address should be correct")
      // });
      // it("Test lpDeposit", async function() {
      //   await token.mint(accounts[1].address,web3.utils.toWei("100"))
      //   await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
      //   await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
      //   await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      //   let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
      //                                         web3.utils.toWei("100"),//poolSupply
      //                                         web3.utils.toWei("10")//tokenamountIn
      //                                         )
      //   assert(minOut >= web3.utils.toWei("4.88"), "should be greater than this")
      //   await charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
      //   assert(await charon.recordBalance() - web3.utils.toWei("104.88") > 0, "record balance should be correct")
      //   assert(await charon.recordBalance() - web3.utils.toWei("104.88") < web3.utils.toWei("1"), "record balance should be correct")
      //   assert(await charon.recordBalanceSynth() - web3.utils.toWei("1048.8")> 0, "record balance synth should be correct")
      //   assert(await charon.recordBalanceSynth() - web3.utils.toWei("1048.8")< web3.utils.toWei("1"), "record balance synth should be correct")
      //   assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei("4.88") > 0 , "mint of tokens should be correct")
      //   assert(await charon.balanceOf(accounts[1].address)*1 - web3.utils.toWei("4.88") < web3.utils.toWei(".01") , "mint of tokens should be correct")
      //   assert(await token.balanceOf(accounts[1].address)*1 +  web3.utils.toWei("4.88") -  web3.utils.toWei("100") > 0, "contract should take tokens")
      //   assert(await chd.balanceOf(accounts[1].address)*1 + web3.utils.toWei("48.8") - web3.utils.toWei("1000") > 0, "contractsynth should take tokens")
      //   let tbal = await token.balanceOf(accounts[1].address)
      //   assert((tbal*1) +  1* web3.utils.toWei("4.88") -  1* web3.utils.toWei("100") < 1* web3.utils.toWei("0.1"), "contract should take tokens")
      //   assert(await chd.balanceOf(accounts[1].address)*1 + 1* web3.utils.toWei("48.8") - 1* web3.utils.toWei("1000") < web3.utils.toWei("0.1"), "contractsynth should take tokens")
      // });
      // it("Test lpWithdraw", async function() {
      //   await token.mint(accounts[1].address,web3.utils.toWei("100"))
      //   await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
      //   await chd.mint(accounts[1].address,web3.utils.toWei("1000"))
      //   await chd.connect(accounts[1]).approve(charon.address,web3.utils.toWei("100"))
      //   let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
      //                                         web3.utils.toWei("100"),//poolSupply
      //                                         web3.utils.toWei("10")//tokenamountIn
      //                                         )
      //   await charon.connect(accounts[1]).lpDeposit(minOut,web3.utils.toWei("100"),web3.utils.toWei("10"))
      //   let poolSupply = await charon.totalSupply()
      //   await charon.connect(accounts[1]).lpWithdraw(web3.utils.toWei("4.88"), web3.utils.toWei("48.8"),web3.utils.toWei("4.88"))
      //   assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("99") > 0, "record balance should be back to correct" )
      //   assert((await charon.recordBalance()*1) - 1*web3.utils.toWei("99.9") < 1*web3.utils.toWei("1"), "record balance should be back to correct" )
      //   assert(await charon.balanceOf(accounts[1].address)*1 < web3.utils.toWei("0.01"), "all pool tokens should be gone")
      //   assert(await token.balanceOf(accounts[1].address)*1 - web3.utils.toWei("99") > 0, "token balance should be back to correct" )
      //   assert(web3.utils.toWei("101") - await token.balanceOf(accounts[1].address)*1 > 0, "token balance should be back to correct" )
      //   });
      // it("Test oracleDeposit", async function() {
      //   let deposit: any;
      //   let relayer: any;
      //   let extAmount:any;
      //   let queryData: any
      //   let queryId: any
      //   let nonce: any
      //     const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
      //     await token.mint(accounts[1].address,web3.utils.toWei("100"))
      //     let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
      //                                               web3.utils.toWei("1000"),
      //                                               web3.utils.toWei("100"),
      //                                               0)
      //     await token.connect(accounts[1]).approve(charon.address,_amount)
      //     deposit = Deposit.new(poseidon);
      //     const aliceKeypair = await new Keypair() // contains private and public keys
      //     const aliceDepositUtxo = await new Utxo({ amount: _amount})//should this include alice's keypair?
      //     let addy = await aliceKeypair.pubkey
      //     const recipient = ethers.utils.getAddress(addy.slice(0,42))
      //     relayer = accounts[2].address
      //     //@ts-ignore
      //     let extDataHash = getExtDataHash(recipient,_amount,relayer,0,FIELD_SIZE)
      //     await buildLeaves(charon,tree)
      //     const { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
      //     //@ts-ignore
      //     inputs = []
      //     outputs = [aliceDepositUtxo]
      //     //@ts-ignore
      //     let outCommitments = []
      //     let outKeys = []
      //     let inNullifier = []
      //     if (inputs.length > 16 || outputs.length > 2) {
      //         throw new Error('Incorrect inputs/outputs count')
      //       }
      //       while (inputs.length !== 2 && inputs.length < 16) {
      //         inputs.push(new Utxo())
      //       }
      //       while (outputs.length < 2) {
      //         outputs.push(new Utxo())
      //       }
      //     for(var i = 0; i< outputs.length;i++){
      //       if (!outputs[i]._commitment) {
      //         outputs[i]._commitment = poseidonHash(deposit.poseidon,[outputs[i].amount,await outputs[i].keypair.pubkey, outputs[i].blinding])
      //       }
      //       outCommitments.push(outputs[i]._commitment)
      //       outKeys.push(await outputs[i].keypair.pubkey)
      //     }
      //     for(var i = 0; i< inputs.length;i++){
      //       if (!inputs[i]._nullifier) {
      //         if (
      //           inputs[i].amount > 0 &&
      //           (inputs[i].index === undefined ||
      //             inputs[i].index === null ||
      //             inputs[i].keypair.privkey === undefined ||
      //             inputs[i].keypair.privkey === null)
      //         ) {
      //           throw new Error('Can not compute nullifier without utxo index or private key')
      //         }
      //         inputs[i]._commitment  = poseidonHash(deposit.poseidon,[inputs[i].amount,await inputs[i].keypair.pubkey, inputs[i].blinding])
      //         const signature = inputs[i].keypair.privkey ? inputs[i].keypair.sign(inputs[i]._commitment, inputs[i].index || 0) : 0
      //         inputs[i]._nullifier = poseidonHash(deposit.poseidon,[inputs[i]._commitment, this.index || 0, await signature])
      //       }
      //       inNullifier.push(inputs[i]._nullifier)
      //     }
        
      //     let inputMerklePathIndices = []
      //     let inputMerklePathElements = []
        
      //     for (const input of inputs) {
      //       if (input.amount > 0) {
      //         input.index = tree.getIndexByElement(toFixedHex(input.getCommitment()))
      //         if (input.index < 0) {
      //           throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
      //         }
      //         inputMerklePathIndices.push(input.index)
      //         let myPath = await tree.path(input.index)
      //         inputMerklePathElements.push(myPath.path_elements)
      //       } else {
      //         inputMerklePathIndices.push(0)
      //         inputMerklePathElements.push(new Array(tree.n_levels).fill(0))
      //       }
      //     }
      //     const input = {
      //         chainID: 2,
      //         root,
      //         publicAmount: BigNumber.from(_amount).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
      //         extDataHash: extDataHash,
      //         inputNullifier: await inNullifier,
      //         outputCommitment: await outCommitments,
      //         privateChainID: 2,
      //         inAmount: await Promise.all(inputs.map(async (x) => await BigNumber.from(x.amount).toString())),
      //         inPrivateKey: await Promise.all(inputs.map(async (x) => await x.keypair.privkey)),
      //         inBlinding: await Promise.all(inputs.map(async (x) => await x.blinding)),
      //         inPathIndices: inputMerklePathIndices,
      //         inPathElements: inputMerklePathElements,
      //         outAmount: await Promise.all(outputs.map(async (x) => await BigNumber.from(x.amount).toString())),
      //         outBlinding: await Promise.all(outputs.map(async (x) => await x.blinding)),
      //         outPubkey: await Promise.all(outputs.map(async (x) => await x.keypair.pubkey))
      //     };
      //     const proof = await prove(input);
      //     const args = {
      //         a: proof.a,
      //         b: proof.b,
      //         c: proof.c,
      //         root: toFixedHex(input.root),
      //         publicAmount: toFixedHex(input.publicAmount),
      //         extDataHash: extDataHash,
      //         inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
      //         outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment()))
      //       }
      //     const extData = {
      //       recipient: toFixedHex(recipient, 20),
      //       extAmount: toFixedHex(BigNumber.from(_amount).toString()),
      //       relayer: toFixedHex(relayer, 20),
      //       fee: toFixedHex(0)
      //     }
      //     await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
      //     const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
      //       ['uint256[2]', 'uint256[2][2]', 'uint256[2]','uint256','bytes32'],
      //       [args.a,[[args.b[0][0],args.b[0][1]],[args.b[1][0],args.b[1][1]]],[args.c[0],args.c[1]],args.publicAmount,args.root]
      //     );
      //     let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
      //     queryData = abiCoder.encode(
      //       ['string', 'bytes'],
      //       ['Charon', abiCoder.encode(
      //         ['uint256','uint256'],
      //         [1,depositId]
      //       )]
      //     );
      //     queryId = h.hash(queryData)
      //     nonce = await tellor2.getNewValueCountbyQueryId(queryId)
      //     let commi = await getTellorSubmission(args,extData);
      //     await tellor2.submitValue(queryId,commi,nonce,queryData)
      //   await h.advanceTime(43200)//12 hours
      //   let tx = await charon2.oracleDeposit([1],[1]);
      //   assert(await charon2.isSpent(args.inputNullifiers[0]) == true ,"nullifierHash should be true")
      //   assert(await charon2.isSpent(args.inputNullifiers[1]) == true ,"nullifierHash should be true")
      //   });
    // it("deposit and withdraw", async function () {
    //     let deposit: any;
    //     let relayer: any;
    //     let extAmount:any;
    //     let queryData: any
    //     let queryId: any
    //     let nonce: any
    //       const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
    //       await token.mint(accounts[1].address,web3.utils.toWei("100"))
    //       let _amount = await charon.calcInGivenOut(web3.utils.toWei("100"),
    //                                                 web3.utils.toWei("1000"),
    //                                                 web3.utils.toWei("100"),
    //                                                 0)
    //       await token.connect(accounts[1]).approve(charon.address,_amount)
    //       deposit = Deposit.new(poseidon);
    //       const aliceKeypair = await new Keypair() // contains private and public keys
    //       let aliceDepositUtxo = await new Utxo({ amount: _amount})//should this include alice's keypair?
    //       let addy = await aliceKeypair.pubkey
    //       let recipient = ethers.utils.getAddress(addy.slice(0,42))
    //       relayer = accounts[2].address
    //       //@ts-ignore
    //       let extDataHash = getExtDataHash(recipient,_amount,relayer,0,FIELD_SIZE)
    //       await buildLeaves(charon,tree)
    //       let { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
    //       //@ts-ignore
    //       inputs = []
    //       outputs = [aliceDepositUtxo]
    //       //@ts-ignore
    //       let outCommitments = []
    //       let outKeys = []
    //       let inNullifier = []
    //       if (inputs.length > 16 || outputs.length > 2) {
    //           throw new Error('Incorrect inputs/outputs count')
    //         }
    //         while (inputs.length !== 2 && inputs.length < 16) {
    //           inputs.push(new Utxo())
    //         }
    //         while (outputs.length < 2) {
    //           outputs.push(new Utxo())
    //         }
    //       for(var i = 0; i< outputs.length;i++){
    //         if (!outputs[i]._commitment) {
    //           outputs[i]._commitment = poseidonHash(deposit.poseidon,[outputs[i].amount,await outputs[i].keypair.pubkey, outputs[i].blinding])
    //         }
    //         outCommitments.push(outputs[i]._commitment)
    //         outKeys.push(await outputs[i].keypair.pubkey)
    //       }
    //       for(var i = 0; i< inputs.length;i++){
    //         if (!inputs[i]._nullifier) {
    //           if (
    //             inputs[i].amount > 0 &&
    //             (inputs[i].index === undefined ||
    //               inputs[i].index === null ||
    //               inputs[i].keypair.privkey === undefined ||
    //               inputs[i].keypair.privkey === null)
    //           ) {
    //             throw new Error('Can not compute nullifier without utxo index or private key')
    //           }
    //           inputs[i]._commitment  = poseidonHash(deposit.poseidon,[inputs[i].amount,await inputs[i].keypair.pubkey, inputs[i].blinding])
    //           const signature = inputs[i].keypair.privkey ? inputs[i].keypair.sign(inputs[i]._commitment, inputs[i].index || 0) : 0
    //           inputs[i]._nullifier = poseidonHash(deposit.poseidon,[inputs[i]._commitment, this.index || 0, await signature])
    //         }
    //         inNullifier.push(inputs[i]._nullifier)
    //       }
        
    //       let inputMerklePathIndices = []
    //       let inputMerklePathElements = []
        
    //       for (const input of inputs) {
    //         if (input.amount > 0) {
    //           input.index = tree.getIndexByElement(toFixedHex(input.getCommitment()))
    //           if (input.index < 0) {
    //             throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
    //           }
    //           inputMerklePathIndices.push(input.index)
    //           let myPath = await tree.path(input.index)
    //           inputMerklePathElements.push(myPath.path_elements)
    //         } else {
    //           inputMerklePathIndices.push(0)
    //           inputMerklePathElements.push(new Array(tree.n_levels).fill(0))
    //         }
    //       }
    //       let input = {
    //           chainID: 2,
    //           root,
    //           publicAmount: BigNumber.from(_amount).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
    //           extDataHash: extDataHash,
    //           inputNullifier: await inNullifier,
    //           outputCommitment: await outCommitments,
    //           privateChainID: 2,
    //           inAmount: await Promise.all(inputs.map(async (x) => await BigNumber.from(x.amount).toString())),
    //           inPrivateKey: await Promise.all(inputs.map(async (x) => await x.keypair.privkey)),
    //           inBlinding: await Promise.all(inputs.map(async (x) => await x.blinding)),
    //           inPathIndices: inputMerklePathIndices,
    //           inPathElements: inputMerklePathElements,
    //           outAmount: await Promise.all(outputs.map(async (x) => await BigNumber.from(x.amount).toString())),
    //           outBlinding: await Promise.all(outputs.map(async (x) => await x.blinding)),
    //           outPubkey: await Promise.all(outputs.map(async (x) => await x.keypair.pubkey))
    //       };
    //       let proof = await prove(input);
    //       let args = {
    //           a: proof.a,
    //           b: proof.b,
    //           c: proof.c,
    //           root: toFixedHex(input.root),
    //           publicAmount: toFixedHex(input.publicAmount),
    //           extDataHash: extDataHash,
    //           inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
    //           outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment()))
    //         }
    //        let  extData = {
    //         recipient: toFixedHex(recipient, 20),
    //         extAmount: toFixedHex(BigNumber.from(_amount).toString()),
    //         relayer: toFixedHex(relayer, 20),
    //         fee: toFixedHex(0)
    //       }
    //       await charon.connect(accounts[1]).depositToOtherChain(args,extData,false);
    //       const dataEncoded = await ethers.utils.AbiCoder.prototype.encode(
    //         ['uint256[2]', 'uint256[2][2]', 'uint256[2]','uint256','bytes32'],
    //         [args.a,[[args.b[0][0],args.b[0][1]],[args.b[1][0],args.b[1][1]]],[args.c[0],args.c[1]],args.publicAmount,args.root]
    //       );
    //       let depositId = await charon.getDepositIdByCommitmentHash(h.hash(dataEncoded))
    //       queryData = abiCoder.encode(
    //         ['string', 'bytes'],
    //         ['Charon', abiCoder.encode(
    //           ['uint256','uint256'],
    //           [1,depositId]
    //         )]
    //       );
    //       queryId = h.hash(queryData)
    //       nonce = await tellor2.getNewValueCountbyQueryId(queryId)
    //       let commi = await getTellorSubmission(args,extData);
    //       await tellor2.submitValue(queryId,commi,nonce,queryData)
    //     await h.advanceTime(43200)//12 hours
    //     let tx = await charon2.oracleDeposit([1],[1]);
    //     assert(await charon2.isSpent(args.inputNullifiers[0]) == true ,"nullifierHash should be true")
    //     assert(await charon2.isSpent(args.inputNullifiers[1]) == true ,"nullifierHash should be true")
    //             //make the other stuff

    //     //deposit = Deposit.new(poseidon);
    //     // Alice sends some funds to withdraw (ignore bob)
    //     let bobSendAmount = web3.utils.toWei("1000")
    //     let bobSendUtxo = new Utxo({ amount: bobSendAmount, keypair: Keypair.fromString(charon2.address) })
    //     let aliceChangeUtxo = new Utxo({
    //         amount: bobSendAmount,
    //         keypair: aliceDepositUtxo.keypair,
    //     })
    //   //  await transaction({ tornadoPool, inputs: [aliceDepositUtxo], outputs: [bobSendUtxo, aliceChangeUtxo] })
    //             recipient = ethers.utils.getAddress(addy.slice(0,42))
    //             relayer = accounts[2].address
    //             //@ts-ignore
    //             extDataHash = getExtDataHash(recipient,_amount,relayer,0,FIELD_SIZE)
    //             await buildLeaves(charon2,tree)
    //             //@ts-ignore
    //             const { root2, path_elements2, path_index2 } = await tree.path(deposit.leafIndex);
    //             //@ts-ignore
    //             inputs = []
    //             outputs = [aliceDepositUtxo]
    //             //@ts-ignore
    //             outCommitments = []
    //             outKeys = []
    //             inNullifier = []
    //             if (inputs.length > 16 || outputs.length > 2) {
    //                 throw new Error('Incorrect inputs/outputs count')
    //               }
    //               while (inputs.length !== 2 && inputs.length < 16) {
    //                 inputs.push(new Utxo())
    //               }
    //               while (outputs.length < 2) {
    //                 outputs.push(new Utxo())
    //               }
    //             for(var i = 0; i< outputs.length;i++){
    //               if (!outputs[i]._commitment) {
    //                 outputs[i]._commitment = poseidonHash(deposit.poseidon,[outputs[i].amount,await outputs[i].keypair.pubkey, outputs[i].blinding])
    //               }
    //               outCommitments.push(outputs[i]._commitment)
    //               outKeys.push(await outputs[i].keypair.pubkey)
    //             }
    //             for(var i = 0; i< inputs.length;i++){
    //               if (!inputs[i]._nullifier) {
    //                 if (
    //                   inputs[i].amount > 0 &&
    //                   (inputs[i].index === undefined ||
    //                     inputs[i].index === null ||
    //                     inputs[i].keypair.privkey === undefined ||
    //                     inputs[i].keypair.privkey === null)
    //                 ) {
    //                   throw new Error('Can not compute nullifier without utxo index or private key')
    //                 }
    //                 inputs[i]._commitment  = poseidonHash(deposit.poseidon,[inputs[i].amount,await inputs[i].keypair.pubkey, inputs[i].blinding])
    //                 const signature = inputs[i].keypair.privkey ? inputs[i].keypair.sign(inputs[i]._commitment, inputs[i].index || 0) : 0
    //                 inputs[i]._nullifier = poseidonHash(deposit.poseidon,[inputs[i]._commitment, this.index || 0, await signature])
    //               }
    //               inNullifier.push(inputs[i]._nullifier)
    //             }
              
    //             inputMerklePathIndices = []
    //             inputMerklePathElements = []
              
    //             for (const input of inputs) {
    //               if (input.amount > 0) {
    //                 input.index = tree.getIndexByElement(toFixedHex(input.getCommitment()))
    //                 if (input.index < 0) {
    //                   throw new Error(`Input commitment ${toFixedHex(input.getCommitment())} was not found`)
    //                 }
    //                 inputMerklePathIndices.push(input.index)
    //                 let myPath = await tree.path(input.index)
    //                 inputMerklePathElements.push(myPath.path_elements)
    //               } else {
    //                 inputMerklePathIndices.push(0)
    //                 inputMerklePathElements.push(new Array(tree.n_levels).fill(0))
    //               }
    //             }
    //             input = {
    //                 chainID: 2,
    //                 root: root2,
    //                 publicAmount: BigNumber.from(_amount).add(FIELD_SIZE).mod(FIELD_SIZE).toString(),
    //                 extDataHash: extDataHash,
    //                 inputNullifier: await inNullifier,
    //                 outputCommitment: await outCommitments,
    //                 privateChainID: 2,
    //                 inAmount: await Promise.all(inputs.map(async (x) => await BigNumber.from(x.amount).toString())),
    //                 inPrivateKey: await Promise.all(inputs.map(async (x) => await x.keypair.privkey)),
    //                 inBlinding: await Promise.all(inputs.map(async (x) => await x.blinding)),
    //                 inPathIndices: inputMerklePathIndices,
    //                 inPathElements: inputMerklePathElements,
    //                 outAmount: await Promise.all(outputs.map(async (x) => await BigNumber.from(x.amount).toString())),
    //                 outBlinding: await Promise.all(outputs.map(async (x) => await x.blinding)),
    //                 outPubkey: await Promise.all(outputs.map(async (x) => await x.keypair.pubkey))
    //             };
    //             proof = await prove(input);
    //             args = {
    //                 a: proof.a,
    //                 b: proof.b,
    //                 c: proof.c,
    //                 root: toFixedHex(input.root),
    //                 publicAmount: toFixedHex(input.publicAmount),
    //                 extDataHash: extDataHash,
    //                 inputNullifiers: inputs.map((x) => toFixedHex(x.getNullifier())),
    //                 outputCommitments: outputs.map((x) => toFixedHex(x.getCommitment()))
    //               }
    //             extData = {
    //               recipient: toFixedHex(recipient, 20),
    //               extAmount: toFixedHex(BigNumber.from(_amount).toString()),
    //               relayer: toFixedHex(relayer, 20),
    //               fee: toFixedHex(0)
    //             }
                
    //     await charon2.transact(args,extData,accounts[5].address)
    //     console.log("this works?")
    //     assert(await chd2.balanceOf(accounts[5].address) == web3.utils.toWei("1000"),"user should have 1000 chd")

    // }).timeout(500000);
});
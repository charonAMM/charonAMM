import { assert, expect } from "chai";
import { ETHTornado__factory, Verifier__factory, Hasher__factory } from "../types";
const { ethers } = require("hardhat");
import { Contract, ContractFactory, BigNumber, BigNumberish } from "ethers";
// @ts-ignore
import { poseidonContract, buildPoseidon } from "circomlibjs";
// @ts-ignore
import { MerkleTree, Hasher } from "../src/merkleTree";
// @ts-ignore
import { groth16, bigInt } from "snarkjs";
import path from "path";
const h = require("usingtellor/test/helpers/helpers.js");
const { abi, bytecode } = require("usingtellor/artifacts/contracts/TellorPlayground.sol/TellorPlayground.json")
const web3 = require('web3');

const ETH_AMOUNT = ethers.utils.parseEther("1");
const HEIGHT = 20;
const denomination = web3.utils.toWei("10")

function poseidonHash(poseidon: any, inputs: BigNumberish[]): string {
    const hash = poseidon(inputs.map((x) => BigNumber.from(x).toBigInt()));
    // Make the number within the field size
    const hashStr = poseidon.F.toString(hash);
    // Make it a valid hex string
    const hashHex = BigNumber.from(hashStr).toHexString();
    // pad zero to make it 32 bytes, so that the output can be taken as a bytes32 contract argument
    const bytes32 = ethers.utils.hexZeroPad(hashHex, 32);
    return bytes32;
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

async function prove(witness: any): Promise<Proof> {
    const wasmPath = path.join(__dirname, "../build/withdraw_js/withdraw.wasm");
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

describe("Charon tests", function () {
    let poseidon: any;
    let hasher: Contract;
    let charon: Contract;
    let charon2: Contract;
    let tellor: Contract;
    let tellor2: Contract;
    let verifier: Contract;
    let accounts: any;
    let cfac: any;
    let token: Contract;
    let token2: Contract;
    let abiCoder = new ethers.utils.AbiCoder();
    let fee = 0;

    before(async () => {
        poseidon = await buildPoseidon();
    });
    beforeEach(async function () {
        accounts = await ethers.getSigners();
            //deploy mock token
        let tfac = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
        token = await tfac.deploy("Dissapearing Space Monkey","DSM");
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
        //deploy charon
        cfac = await ethers.getContractFactory("contracts/Charon.sol:Charon");
        charon= await cfac.deploy(verifier.address,hasher.address,token.address,fee,tellor.address,denomination,HEIGHT,1);
        await charon.deployed();
        //now deploy on other chain (same chain, but we pretend w/ oracles)
        token2 = await tfac.deploy("Dissapearing Space Monkey2","DSM2");
        await token2.deployed();
        await token2.mint(accounts[0].address,web3.utils.toWei("1000000"))//1M
        tellor2 = await TellorOracle.deploy();
        await tellor2.deployed();
        charon2 = await cfac.deploy(verifier.address,hasher.address,token2.address,fee,tellor2.address,denomination,HEIGHT,2);
        await charon2.deployed();
        //now set both of them. 
        await token.approve(charon.address,web3.utils.toWei("100"))//100
        await token2.approve(charon2.address,web3.utils.toWei("100"))//100
        await charon.bind(web3.utils.toWei("100"),web3.utils.toWei("100"));
        await charon2.bind(web3.utils.toWei("100"),web3.utils.toWei("100"))
        await charon.finalize();
        await charon2.finalize();
    });
    it("generates same poseidon hash", async function () {
        const res = await hasher["poseidon(uint256[2])"]([1, 2]);
        const res2 = poseidon([1, 2]);
        assert.equal(res.toString(), poseidon.F.toString(res2));
    }).timeout(500000);
    it("Test Constructor", async function() {
        assert(await charon.tellor() == tellor.address, "tellor address should be set")
        assert(await charon.levels() == HEIGHT, "merkle Tree height should be set")
        assert(await charon.hasher() == hasher.address, "hasher should be set")
        assert(await charon.verifier() == verifier.address, "verifier should be set")
        assert(await charon.token() == token.address, "token should be set")
        assert(await charon.fee() == fee, "fee should be set")
        assert(await charon.denomination() == denomination, "denomination should be set")
        assert(await charon.controller() == accounts[0].address, "controller should be set")
      });
      it("Test changeController", async function() {
        await charon.changeController(accounts[1].address)
        assert(await charon.controller() == accounts[1].address, "controller should change")
      });
      it("Test depositToOtherChain", async function() {
        const commitment = h.hash("test")
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
        await charon.connect(accounts[1]).depositToOtherChain(commitment);
        assert(await charon.getDepositCommitmentsById(1) == commitment, "commitment should be stored")
        assert(await charon.getDepositIdByCommitment(commitment) == 1, "reverse commitment mapping should work")
        assert(await charon.didDepositCommitment(commitment), "didDeposit should be true")
        assert(await charon.recordBalance() == web3.utils.toWei("110"), "recordBalance should go up")
        assert(await token.balanceOf(accounts[1].address) == web3.utils.toWei("90"), "balance should change properly")
      });
      it("Test finalize", async function() {
        let testCharon = await cfac.deploy(verifier.address,hasher.address,token2.address,fee,tellor2.address,denomination,HEIGHT);
        await testCharon.deployed();
        await h.expectThrow(testCharon.connect(accounts[1]).finalize())//must be controller
        await testCharon.finalize();
        await h.expectThrow(testCharon.finalize())//already finalized
        assert(await testCharon.finalized(), "should be finalized")
        assert(await testCharon.balanceOf(accounts[0].address) - await testCharon.INIT_POOL_SUPPLY() == 0, "should have full balance")
      });
      it("Test lpDeposit", async function() {
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
        let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
                                              web3.utils.toWei("1"),//tokenWeightIn
                                              web3.utils.toWei("100"),//poolSupply
                                              web3.utils.toWei("2"),//totalWeight
                                              web3.utils.toWei("10")//tokenamountIn
                                              )
        assert(minOut >= web3.utils.toWei("4.88"), "should be greater than this")
        await charon.connect(accounts[1]).lpDeposit(web3.utils.toWei("10"),minOut)
        assert(await charon.recordBalance() == web3.utils.toWei("110"), "record balance should be correct")
        assert(await charon.balanceOf(accounts[1].address) - minOut == 0, "mint of tokens should be correct")
        assert(await token.balanceOf(accounts[1].address) == web3.utils.toWei("90"), "contract should take tokens")
      });
      it("Test lpWithdraw", async function() {
        await token.mint(accounts[1].address,web3.utils.toWei("100"))
        await token.connect(accounts[1]).approve(charon.address,web3.utils.toWei("10"))
        let minOut = await charon.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
                                              web3.utils.toWei("1"),//tokenWeightIn
                                              web3.utils.toWei("100"),//poolSupply
                                              web3.utils.toWei("2"),//totalWeight
                                              web3.utils.toWei("10")//tokenamountIn
                                              )
        await charon.connect(accounts[1]).lpDeposit(web3.utils.toWei("10"),minOut)
        let poolSupply = await charon.totalSupply()
        let recordBalance = await charon.recordBalance() 
        let poolOut = await charon.calcSingleOutGivenPoolIn(recordBalance,//tokenBalanceOut
                                      web3.utils.toWei("1"),//tokenWeightOut
                                      poolSupply,
                                      web3.utils.toWei("2"),//totalWeight
                                      minOut,//poolAmountIn
                                      0//swapfee
        )
        assert(poolOut >= web3.utils.toWei("10"), "should spit out correct amount of tokens")
        await charon.connect(accounts[1]).lpWithdraw(minOut, poolOut)
        assert(await charon.recordBalance() > web3.utils.toWei("99"), "record balance should be back to correct" )
        assert(web3.utils.toWei("101") - await charon.recordBalance() > 0, "record balance should be back to correct" )
        //test fee later
        assert(await charon.balanceOf(accounts[1].address) == 0, "all pool tokens should be gone")
        assert(await token.balanceOf(accounts[1].address) - web3.utils.toWei("99") > 0, "token balance should be back to correct" )
        assert(web3.utils.toWei("101") - await token.balanceOf(accounts[1].address) > 0, "token balance should be back to correct" )
        });
      it("Test oracleDeposit", async function() {
        const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        let deposit = Deposit.new(poseidon);
        tree.insert(deposit.commitment)
        await token.approve(charon.address,denomination)
        await charon.depositToOtherChain(toFixedHex(deposit.commitment));
        let depositId = await charon.getDepositIdByCommitment(toFixedHex(deposit.commitment))
        let queryData = abiCoder.encode(
          ['string', 'bytes'],
          ['Charon', abiCoder.encode(
            ['uint256','uint256'],
            [1,depositId]
          )]
        );
        let queryId = h.hash(queryData)
        let nonce = await tellor2.getNewValueCountbyQueryId(queryId)
        await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
        await h.advanceTime(43200)//12 hours
        let tx = await charon2.oracleDeposit(1,depositId);
        const receipt = await tx.wait();
        const events = await charon2.queryFilter(
            charon2.filters.OracleDeposit(),
            receipt.blockHash
        );
        //@ts-ignore
        deposit.leafIndex = events[0].args._insertedIndex;
        assert(await charon2.isCommitment(toFixedHex(deposit.commitment)), "should be a commitment")
        assert(await charon2.isSpent(deposit.nullifierHash) == false, "nullifierHash should be false")
        });
    it("deposit and withdraw", async function () {
        const [userOldSigner, relayerSigner, userNewSigner] =await ethers.getSigners();
        let tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        let deposit = Deposit.new(poseidon);
        await token.approve(charon.address,denomination)
        await charon.depositToOtherChain(toFixedHex(deposit.commitment));
        let depositId = await charon.getDepositIdByCommitment(toFixedHex(deposit.commitment))
        let queryData = abiCoder.encode(
          ['string', 'bytes'],
          ['Charon', abiCoder.encode(
            ['uint256','uint256'],
            [1,depositId]
          )]
        );
        let queryId = h.hash(queryData)
        let nonce = await tellor2.getNewValueCountbyQueryId(queryId)
        await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
        await h.advanceTime(43200)//12 hours
        let tx = await charon2.oracleDeposit(1,depositId);
        const receipt = await tx.wait();
        const events = await charon2.queryFilter(
            charon2.filters.OracleDeposit(),
            receipt.blockHash
        );
        //@ts-ignore
        deposit.leafIndex = events[0].args._insertedIndex;
        //@ts-ignore
        assert.equal(events[0].args._commitment, deposit.commitment);
        console.log("Deposit gas cost", receipt.gasUsed.toNumber());
        //@ts-ignore
        deposit.leafIndex = events[0].args._insertedIndex;
        assert.equal(await tree.root(), await charon2.roots(0));
        await tree.insert(deposit.commitment);
        assert.equal(tree.totalElements, await charon2.nextIndex());
        assert.equal(await tree.root(), await charon2.roots(1));
        const nullifierHash = deposit.nullifierHash;
        const recipient = await userNewSigner.getAddress();
        const relayer = await relayerSigner.getAddress();
        const fee = 0;
        //@ts-ignore
        const { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
        const witness = {
            // Public
            2,
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            privateChainID: 2,
            nullifier: BigNumber.from(depositAttacker.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        };
        const solProof = await prove(witness);
        const txWithdraw = await charon2.connect(relayerSigner)
            .secretWithdraw(solProof, root, nullifierHash, recipient, relayer, fee, false);
        const receiptWithdraw = await txWithdraw.wait();
        console.log("Withdraw gas cost", receiptWithdraw.gasUsed.toNumber());
    }).timeout(500000);
    it("prevent a user withdrawing twice", async function () {
        const [userOldSigner, relayerSigner, userNewSigner] =
            await ethers.getSigners();
            const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        const deposit = Deposit.new(poseidon);
        await token.approve(charon.address,denomination)
        await charon.depositToOtherChain(toFixedHex(deposit.commitment));
        let depositId = await charon.getDepositIdByCommitment(toFixedHex(deposit.commitment))
        let queryData = abiCoder.encode(
          ['string', 'bytes'],
          ['Charon', abiCoder.encode(
            ['uint256','uint256'],
            [1,depositId]
          )]
        );
        let queryId = h.hash(queryData)
        let nonce = await tellor2.getNewValueCountbyQueryId(queryId)
        await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
        await h.advanceTime(43200)//12 hours
        let tx = await charon2.oracleDeposit(1,depositId);
        const receipt = await tx.wait();
        const events = await charon2.queryFilter(
            charon2.filters.OracleDeposit(),
            receipt.blockHash
        );
        //@ts-ignore
        deposit.leafIndex = events[0].args._insertedIndex;
        await tree.insert(deposit.commitment);
        const nullifierHash = deposit.nullifierHash;
        const recipient = await userNewSigner.getAddress();
        const relayer = await relayerSigner.getAddress();
        const fee = 0;
        //@ts-ignore
        const { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
        const witness = {
            // Public
            2,
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            privateChainID: 2,
            nullifier: BigNumber.from(depositAttacker.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        };
        const solProof = await prove(witness);
        // First withdraw
        await charon2.connect(relayerSigner).secretWithdraw(solProof, root, nullifierHash, recipient, relayer, fee, false);
        // Second withdraw
        await charon2.connect(relayerSigner).secretWithdraw(solProof, root, nullifierHash, recipient, relayer, fee, false)
            .then(
                () => {
                    assert.fail("Expect tx to fail");
                },
                (error:any) => {
                    expect(error.message).to.have.string(
                        "The note has been already spent"
                    );
                }
            );
    }).timeout(500000);
    it("prevent a user withdrawing from a non-existent root", async function () {
        const [honestUser, relayerSigner, attacker] = await ethers.getSigners();
        // An honest user makes a deposit
        const depositHonest = Deposit.new(poseidon);
        await token.approve(charon.address,denomination)
        await charon.depositToOtherChain(toFixedHex(depositHonest.commitment));
        let depositId = await charon.getDepositIdByCommitment(toFixedHex(depositHonest.commitment))
        let queryData = abiCoder.encode(
          ['string', 'bytes'],
          ['Charon', abiCoder.encode(
            ['uint256','uint256'],
            [1,depositId]
          )]
        );
        let queryId = h.hash(queryData)
        let nonce = await tellor2.getNewValueCountbyQueryId(queryId)
        await tellor2.submitValue(queryId,toFixedHex(depositHonest.commitment),nonce,queryData)
        await h.advanceTime(43200)//12 hours
        let tx = await charon2.oracleDeposit(1,depositId);
        const receipt = await tx.wait();
        const events = await charon2.queryFilter(
            charon2.filters.OracleDeposit(),
            receipt.blockHash
        );
        //@ts-ignore
        depositHonest.leafIndex = events[0].args._insertedIndex;
        // The attacker never made a deposit on chain
        const depositAttacker = Deposit.new(poseidon);
        depositAttacker.leafIndex = 1;
        // The attacker constructed a tree which includes their deposit
        const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        await tree.insert(depositHonest.commitment);
        await tree.insert(depositAttacker.commitment);
        const nullifierHash = depositAttacker.nullifierHash;
        const recipient = await attacker.getAddress();
        const relayer = await relayerSigner.getAddress();
        const fee = 0;
        // Attacker construct the proof
        const { root, path_elements, path_index } = await tree.path(depositAttacker.leafIndex);
        const witness = {
            // Public
            2,
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            privateChainID: 2,
            nullifier: BigNumber.from(depositAttacker.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
        };
        const solProof = await prove(witness);
        await charon2.connect(relayerSigner).secretWithdraw(solProof, root, nullifierHash, recipient, relayer, fee,false)
            .then(
                () => {
                    assert.fail("Expect tx to fail");
                },
                (error:any) => {
                    expect(error.message).to.have.string(
                        "Cannot find your merkle root"
                    );
                }
            );
    }).timeout(500000);
    it("Test secretWithdraw - no LP", async function() {
        const [userOldSigner, relayerSigner, userNewSigner] =await ethers.getSigners();
        const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        await token.mint(userOldSigner.address,denomination);
        await token.connect(userOldSigner).approve(charon.address,denomination)
        let queryData, queryId,depositId,nonce;
          const deposit = Deposit.new(poseidon);
          await tree.insert(deposit.commitment);
          await charon.connect(userOldSigner).depositToOtherChain(deposit.commitment);
          depositId = await charon.getDepositIdByCommitment(deposit.commitment)
          queryData = abiCoder.encode(
            ['string', 'bytes'],
            ['Charon', abiCoder.encode(
              ['uint256','uint256'],
              [1,depositId]
            )]
          );
          queryId = h.hash(queryData)
          nonce = await tellor2.getNewValueCountbyQueryId(queryId)
          await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
          await h.advanceTime(43200)//12 hours
          //withdraw on other chain
          let tx = await charon2.oracleDeposit(1,depositId);
          const receipt = await tx.wait();
          const events = await charon2.queryFilter(
              charon2.filters.OracleDeposit(),
              receipt.blockHash
          );
          //@ts-ignore
          deposit.leafIndex = events[0].args._insertedIndex;
          //@ts-ignore
          assert.equal(events[0].args._commitment, deposit.commitment);
          assert.equal(tree.totalElements, await charon2.nextIndex());
          assert.equal(await tree.root(), await charon2.roots(1));
          const nullifierHash = deposit.nullifierHash;
          const recipient = await userNewSigner.getAddress();
          const relayer = await relayerSigner.getAddress();
          const fee = 0;
          //@ts-ignore
          const { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
          const witness = {
            // Public
            2,
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            privateChainID: 2,
            nullifier: BigNumber.from(depositAttacker.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
          };
          const solProof = await prove(witness);
          assert(await charon2.isSpent(nullifierHash) == false, "nullifierHash should be false")
          let isA = await charon2.isSpentArray([nullifierHash]);
          assert(isA[0] == false, "value in array should be false")
          let initSynth = await charon2.recordBalanceSynth()
          let initRecord = await charon2.recordBalance()
          assert(await charon2.isKnownRoot(root),"should be known root")
          const txWithdraw = await charon2.connect(relayerSigner)
              .secretWithdraw(solProof, root, nullifierHash, recipient, relayer, fee, false);
          assert(await charon2.isSpent(nullifierHash), "nullifierHash should be true")
          isA = await charon2.isSpentArray([nullifierHash]);
          assert(isA[0],"should be spent")
          let tokenOut = await charon2.calcOutGivenIn(
                web3.utils.toWei("100"),
                web3.utils.toWei("1"),
                web3.utils.toWei("100"), 
                web3.utils.toWei("1"),
                denomination,
                0
          )
          assert(await charon2.recordBalanceSynth() - initSynth == 0, "synth balance should be the same")
          assert(await charon2.recordBalance() == initRecord - tokenOut, "recordBalance should change")
          assert(await token2.balanceOf(userNewSigner.address) - tokenOut == 0, "should be paid")
      });
      it("Test secretWithdraw - to LP", async function() {
        const [userOldSigner, relayerSigner, userNewSigner] =await ethers.getSigners();
        const tree = new MerkleTree(HEIGHT,"test",new PoseidonHasher(poseidon));
        await token.mint(accounts[2].address,denomination);
        await token.connect(accounts[2]).approve(charon.address,denomination)
        const deposit = Deposit.new(poseidon);
        let queryData, queryId,depositId,nonce;
        assert.equal(await tree.root(), await charon2.roots(0));
        await tree.insert(deposit.commitment);
          await charon.connect(accounts[2]).depositToOtherChain(toFixedHex(deposit.commitment));
          depositId = await charon.getDepositIdByCommitment(toFixedHex(deposit.commitment))
          queryData = abiCoder.encode(
            ['string', 'bytes'],
            ['Charon', abiCoder.encode(
              ['uint256','uint256'],
              [1,depositId]
            )]
          );
          queryId = h.hash(queryData)
          nonce = await tellor2.getNewValueCountbyQueryId(queryId)
          await tellor2.submitValue(queryId,toFixedHex(deposit.commitment),nonce,queryData)
          await h.advanceTime(43200)//12 hours
          //withdraw on other chain
          let tx = await charon2.oracleDeposit(1,depositId);
          const receipt = await tx.wait();
          const events = await charon2.queryFilter(
              charon2.filters.OracleDeposit(),
              receipt.blockHash
          );
          //@ts-ignore
          deposit.leafIndex = events[0].args._insertedIndex;
          //@ts-ignore
          assert.equal(events[0].args._commitment, deposit.commitment);
          //@ts-ignore
          assert.equal(tree.totalElements, await charon2.nextIndex());
          assert.equal(await tree.root(), await charon2.roots(1));
          const nullifierHash = deposit.nullifierHash;
          const recipient = await userNewSigner.getAddress();
          const relayer = await relayerSigner.getAddress();
          const fee = 0;
          //@ts-ignore
          const { root, path_elements, path_index } = await tree.path(deposit.leafIndex);
          const witness = {
            // Public
            2,
            root,
            nullifierHash,
            recipient,
            relayer,
            fee,
            // Private
            privateChainID: 2,
            nullifier: BigNumber.from(depositAttacker.nullifier).toBigInt(),
            pathElements: path_elements,
            pathIndices: path_index,
          };
          const solProof = await prove(witness);
          assert(await charon2.isSpent(nullifierHash) == false, "nullifierHash should be false")
          let isA = await charon2.isSpentArray([nullifierHash]);
          assert(isA[0] == false, "value in array should be false")
          let initSynth = await charon2.recordBalanceSynth()
          let initRecord = await charon2.recordBalance()
          assert(await charon2.isKnownRoot(root),"should be known root")
          const txWithdraw = await charon2.connect(accounts[1])
              .secretWithdraw(solProof, root, nullifierHash, recipient, relayer, fee, true);
          assert(await charon2.isSpent(nullifierHash), "nullifierHash should be true")
          isA = await charon2.isSpentArray([nullifierHash]);
          assert(isA[0] == true, "should be spent")
          let poolOut = await charon2.calcPoolOutGivenSingleIn(web3.utils.toWei("100"),//tokenBalanceIn
          web3.utils.toWei("1"),//tokenWeightIn
          web3.utils.toWei("100"),//poolSupply
          web3.utils.toWei("2"),//totalWeight
          denomination
          )
        assert(await charon2.recordBalanceSynth() - initSynth - denomination == 0, "synth balance should go up")
        assert(await charon2.recordBalance() - initRecord == 0, "recordBalance should be the same")
        assert(await token2.balanceOf(userNewSigner.address) == 0, "no tokens should be paid")
        assert(await charon2.balanceOf(userNewSigner.address) - poolOut == 0, "pool tokens paid")
      });
});

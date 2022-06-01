<p align="center">
    <img src= './public/charon.jpg' height="300"/>
</p>


## Charon

<b>Charon</b> is a decentralized protocol for a Privacy Enabled Cross-Chain AMM (PECCAMM). It achieves privacy by breaking the link between deposits on one chain and withdrawals on another.  It works by having AMM's on seperate chains, but LP deposits in one of the assets and all orders are only achieved via depositing on the opposite chain and then withdrawing it as either an LP or trade with any address. To acheive cross-chain functionality, Charon utilizes [Tellor](https://www.tellor.io) to trustlessly pass commitments(proof of deposits) between chains. 


## Setting up and testing

Install Dependencies
```
npm i
```
Create Verifier.sol and circuits
```
circom withdraw.circom --r1cs --wasm --sym

snarkjs r1cs export json withdraw.r1cs withdraw.r1cs.json
cat withdraw.r1cs.json
cd withdraw_js
$withdraw_js node generate_witness.js withdraw.wasm ../input.json ../witness.wtns
snarkjs groth16 setup withdraw.r1cs powersOfTau28_hez_final_24.ptau withdraw_0000.zkey
snarkjs zkey contribute withdraw_0000.zkey withdraw_0001.zkey --name="1st Contributor Name" -v
snarkjs zkey contribute withdraw_0001.zkey withdraw_0002.zkey --name="Second contribution Name" -v -e="Another random entropy"

snarkjs zkey export bellman withdraw_0002.zkey  challenge_phase2_0003
snarkjs zkey bellman contribute bn128 challenge_phase2_0003 response_phase2_0003 -e="some random text"
snarkjs zkey import bellman withdraw_0002.zkey response_phase2_0003 withdraw_0003.zkey -n="Third contribution name"
snarkjs zkey beacon withdraw_0003.zkey withdraw_final.zkey 0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 -n="Final Beacon phase2"
snarkjs zkey export verificationkey withdraw_final.zkey verification_key.json
snarkjs groth16 prove withdraw_final.zkey witness.wtns proof.json public.json 

//verify
snarkjs groth16 verify verification_key.json public.json proof.json
snarkjs zkey export solidityverifier circuit_final.zkey verifier.sol
//simulate smart contract call
snarkjs zkey export soliditycalldata public.json proof.json

``
Create hasher
```
npx run scripts/generateHasher.js
```
Now move Verifier.sol to your contracts folder, then compile

```
npx hardhat compile
```
Test
```
npx hardhat test
```


## How it works

For this example, we'll use Ethereum and Polygon, although the system can work on any two EVM chains with Tellor support. It also works with any tokens, but for this example, we'll use LUSD on mainnet and USDC on Polygon (two stablecoins for ease of math). 

Flow 

    Setup done by controller:
     - Launch contract on Ethereum
     - Launch contract on Polygon
     - Deposit 100k LUSD in Ethereum contract and 100k USDC on Polygon to initialize pools

    Functions for users 

    (on Ethereum as example)
    - LP deposit (deposit LUSD as an LP on the ETH contract, earn fees).  
    - LP withdraw
    - depositToOtherChain (deposit LUSD with zk commitment)
    - oracleDeposit (oracle puts your information into the other chains contract)
    - secretWithdraw( withdraw your deposit from Polygon)
        - can either withdraw as LP or as market order 



## TODO/ Thoughts

    - whitepaper
    - add fee going to LPs (now just owner)
    - write scripts for deploying on multiple chains with different verifiers
    - document how to handle different tokens.  Should input have tellor oracle give price?  Does it need a price if the same amount of tokens?  would this kill anonymity? 
    - can we allow minting outside of AMM structure?  pros/cons?  
    - add multiple chains (how to list which chains are approved?  How to add?  Is it handled on tellor side? Do we need a governance token!!?!)
    - add more tests, e2e tests and outline oracle attacks
    - get audit
    - should we even allow passive LP's?  Should we make you fund by trade? 
    - if just two chains, then you can LP everyone as soon as the oracle deposits....better or worse?
    - how long until the merkle tree fills up? Is this even an issue?






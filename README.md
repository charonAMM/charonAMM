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
npm run build
```
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






<p align="center">
    <img src= './public/charon.jpg' height="300"/>
</p>


## Charon

<b>Charon</b> is a decentralized protocol for a Privacy Enabled Cross-Chain AMM (PECCAMM). It achieves privacy by breaking the link between deposits on one chain and withdrawals on another.  It works by having AMM's on seperate chains, but LP deposits in one of the assets and all orders are only achieved via depositing on the opposite chain and then withdrawing it as either an LP or trade with any address. To acheive cross-chain functionality, Charon utilizes [Tellor](https://www.tellor.io) to trustlessly pass commitments(proof of deposits) between chains. 

[Whitepaper](https://www.github.com/themandalore/charon/public.whitepaper.pdf)

## Setting up and testing

First, you must have the Circom 2 compiler installed. See [installation
instructions](https://docs.circom.io/getting-started/installation/) for details.

The build step compiles the circuit, does untrusted setup, generates verifier contract, and compiles all the contracts. It could take a while at the setup step.

```sh
npm install
npm run build
```

```sh
npm run test
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



## Benchmark

```sh
npm run info
```

## Donations

ETH - 0x92683a09B64148369b09f96350B6323D37Af6AE3
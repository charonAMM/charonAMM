<p align="center">
    <img src= './public/charon.jpg' height="300"/>
</p>


## Charon

<b>Charon</b> is a decentralized protocol for a Privacy Enabled Cross-Chain AMM (PECCAMM). It achieves privacy by breaking the link between deposits on one chain and withdrawals on another.  It works by having AMM's on seperate chains, but LP deposits in one of the assets and all orders are only achieved via depositing on the opposite chain and then withdrawing it as either an LP or trade with any address. To acheive cross-chain functionality, Charon utilizes [Tellor](https://www.tellor.io) to trustlessly pass commitments(proof of deposits) between chains. 

For more information, check out the [whitepaper](https://github.com/themandalore/charon/blob/main/public/whitepaper.pdf)

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

## Benchmark

```sh
npm run info
```

## Donations

ETH - 0x92683a09B64148369b09f96350B6323D37Af6AE3
#!/bin/bash -e
POWERS_OF_TAU=15 # circuit will support max 2^POWERS_OF_TAU constraints
mkdir -p artifacts/circuits
if [ ! -f artifacts/circuits/ptau$POWERS_OF_TAU ]; then
  echo "Downloading powers of tau file"
  curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_$POWERS_OF_TAU.ptau --create-dirs -o artifacts/circuits/ptau$POWERS_OF_TAU
fi
mkdir -p build && circom circuits/transaction.circom --r1cs --wasm -o build
npx circom -v -r build/transaction.r1cs -w build/transaction_js/transaction.wasm -s artifacts/circuits/transaction.sym circuits/transaction.circom
npx snarkjs groth16 setup build/transaction.r1cs artifacts/circuits/ptau$POWERS_OF_TAU artifacts/circuits/tmp_transaction.zkey
echo "qwe" | npx snarkjs zkey contribute artifacts/circuits/tmp_transaction.zkey artifacts/circuits/transaction.zkey
npx snarkjs zkey export solidityverifier artifacts/circuits/transaction.zkey artifacts/circuits/Verifier.sol
sed -i.bak "s/contract Verifier/contract Verifier/g" build/Verifier.sol
#zkutil setup -c artifacts/circuits/transaction$1.r1cs -p artifacts/circuits/transaction$1.params
#zkutil generate-verifier -p artifacts/circuits/transaction$1.params -v artifacts/circuits/Verifier.sol
npx snarkjs info -r build/transaction.r1cs

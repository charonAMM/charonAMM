#!/bin/bash -e
POWERS_OF_TAU=20 # circuit will support max 2^POWERS_OF_TAU constraints
mkdir -p artifacts/circuits
if [ ! -f artifacts/circuits/ptau$POWERS_OF_TAU ]; then
  echo "Downloading powers of tau file"
  curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_$POWERS_OF_TAU.ptau --create-dirs -o artifacts/circuits/ptau$POWERS_OF_TAU
fi
echo "1"
circom circuits/transaction$1.circom --r1cs --wasm --sym --c -o artifacts/circuits
echo "2"
#circom -v -r artifacts/circuits/transaction$1.r1cs -w artifacts/circuits/transaction$1.wasm -s artifacts/circuits/transaction$1.sym circuits/transaction$1.circom
npx snarkjs groth16 setup artifacts/circuits/transaction$1.r1cs artifacts/circuits/ptau$POWERS_OF_TAU artifacts/circuits/tmp_transaction$1.zkey
echo "qwe" | npx snarkjs zkey contribute artifacts/circuits/tmp_transaction$1.zkey artifacts/circuits/charon_ceremony$1.zkey

#now get people to contribute more!!!
# echo "qwe" | npx snarkjs zkey contribute transaction$1.zkey new_transaction$1.zkey
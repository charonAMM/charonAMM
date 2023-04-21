npx snarkjs zkey export solidityverifier artifacts/circuits/charon_ceremonyFINAL$1.zkey artifacts/circuits/Verifier$1.sol
sed -i.bak "s/contract Verifier/contract Verifier${1}/g" artifacts/circuits/Verifier$1.sol
#zkutil setup -c artifacts/circuits/transaction$1.r1cs -p artifacts/circuits/transaction$1.params
#zkutil generate-verifier -p artifacts/circuits/transaction$1.params -v artifacts/circuits/Verifier.sol
npx snarkjs info -r artifacts/circuits/transaction$1.r1cs



#snarkjs zkey verify artifacts/circuits/transaction2.r1cs artifacts/circuits/ptau20 artifacts/circuits/charon_ceremony2.zkey 
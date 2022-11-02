const { encrypt, decrypt, getEncryptionPublicKey } = require('@metamask/eth-sig-util')
const { ethers } = require('hardhat')
const { BigNumber } = ethers
const { poseidonHash, toFixedHex } = require('./utils')

function packEncryptedMessage(encryptedMessage) {
  const nonceBuf = Buffer.from(encryptedMessage.nonce, 'base64')
  const ephemPublicKeyBuf = Buffer.from(encryptedMessage.ephemPublicKey, 'base64')
  const ciphertextBuf = Buffer.from(encryptedMessage.ciphertext, 'base64')
  const messageBuff = Buffer.concat([
    Buffer.alloc(24 - nonceBuf.length),
    nonceBuf,
    Buffer.alloc(32 - ephemPublicKeyBuf.length),
    ephemPublicKeyBuf,
    ciphertextBuf,
  ])
  return '0x' + messageBuff.toString('hex')
}

function unpackEncryptedMessage(encryptedMessage) {
  if (encryptedMessage.slice(0, 2) === '0x') {
    encryptedMessage = encryptedMessage.slice(2)
  }
  const messageBuff = Buffer.from(encryptedMessage, 'hex')
  const nonceBuf = messageBuff.slice(0, 24)
  const ephemPublicKeyBuf = messageBuff.slice(24, 56)
  const ciphertextBuf = messageBuff.slice(56)
  return {
    version: 'x25519-xsalsa20-poly1305',
    nonce: nonceBuf.toString('base64'),
    ephemPublicKey: ephemPublicKeyBuf.toString('base64'),
    ciphertext: ciphertextBuf.toString('base64'),
  }
}

async function dPoseidon(input){
  return await poseidonHash(input);
}

class Keypair {
  /**
   * Initialize a new keypair. Generates a random private key if not defined
   *
   * @param {string} privkey
   */
  constructor({privkey = ethers.Wallet.createRandom().privateKey, myHashFunc=poseidonHash}) {
    this.privkey = privkey
    this.pubkey = myHashFunc([privkey])
    this.encryptionKey = getEncryptionPublicKey(privkey.slice(2))
  }

  async toString() {
    let key = this.pubkey
    return toFixedHex(key) + Buffer.from(this.encryptionKey, 'base64').toString('hex')
  }

  /**
   * Key address for this keypair, alias to {@link toString}
   *
   * @returns {string}
   */
  address() {
    return this.toString()
  }

  /**
   * Initialize new keypair from address string
   *
   * @param str
   * @returns {Keypair}
   */
  static fromString(str,myHashFunc) {
    if (str.length === 130) {
      str = str.slice(2)
    }
    if (str.length !== 128) {
      throw new Error('Invalid key length')
    }
    return Object.assign(new Keypair({myHashFunc: myHashFunc}), {
      privkey: null,
      pubkey: BigNumber.from('0x' + str.slice(0, 64)),
      encryptionKey: Buffer.from(str.slice(64, 128), 'hex').toString('base64'),
    })
  }

  /**
   * Sign a message using keypair private key
   *
   * @param {string|number|BigNumber} commitment a hex string with commitment
   * @param {string|number|BigNumber} merklePath a hex string with merkle path
   * @returns {BigNumber} a hex string with signature
   */
  sign({commitment, merklePath,hashFunc = poseidonHash}) {
    return hashFunc([this.privkey, commitment, merklePath])
  }

  /**
   * Encrypt data using keypair encryption key
   *
   * @param {Buffer} bytes
   * @returns {string} a hex string with encrypted data
   */
  encrypt(bytes) {
    return packEncryptedMessage(
      encrypt({publicKey: this.encryptionKey, data: bytes.toString('base64'), version:'x25519-xsalsa20-poly1305'}),
    )
  }

  /**
   * Decrypt data using keypair private key
   *
   * @param {string} data a hex string with data
   * @returns {Buffer}
   */
  decrypt(data) {
    return Buffer.from(decrypt({encryptedData: unpackEncryptedMessage(data), privateKey: this.privkey.slice(2)}), 'base64')
  }
}

module.exports = {
  Keypair,
  packEncryptedMessage,
  unpackEncryptedMessage,
}

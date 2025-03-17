import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";
import nacl from 'tweetnacl'
import bs58 from 'bs58';
import { green, reset, red } from './ansi-colorcodes';

// const mnemonic = generateMnemonic(); // or you can use yours to import a wallet, if have any
var mnemonic:string;
var seed:Buffer;

export function setHDWords(mnemonic_words:string) {
    mnemonic = mnemonic_words;
    console.log(`secret phrase: ${green}${mnemonic}${reset}`);
    seed = mnemonicToSeedSync(mnemonic);
    console.log('\nmaster seed:', seed.toString('hex'));
}

export function getSrcWalletKeyPairs(index:number) {
    const solanaDerivationPath = `m/44'/501'/${index}'/0'`;
    const derivedSeed = derivePath(solanaDerivationPath, seed.toString("hex")).key;
    const privateKey = nacl.sign.keyPair.fromSeed(derivedSeed).secretKey;
    return Keypair.fromSecretKey(privateKey);
}

export function getSrcWalletPrivKey(index:number) {
    const solanaDerivationPath = `m/44'/501'/${index}'/0'`;
    const derivedSeed = derivePath(solanaDerivationPath, seed.toString("hex")).key;
    const privateKey = nacl.sign.keyPair.fromSeed(derivedSeed).secretKey;
    return bs58.encode(privateKey);
}

export function getSrcWalletAddress(index:number) {
    const solanaDerivationPath = `m/44'/501'/${index}'/0'`;
    const derivedSeed = derivePath(solanaDerivationPath, seed.toString("hex")).key;
    const privateKey = nacl.sign.keyPair.fromSeed(derivedSeed).secretKey;
    return Keypair.fromSecretKey(privateKey).publicKey.toBase58();
}

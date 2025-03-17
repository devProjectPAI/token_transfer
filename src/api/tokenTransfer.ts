import { Keypair, PublicKey, ParsedAccountData, Transaction, TransactionInstruction, TransactionMessage, SystemProgram, VersionedTransaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { NATIVE_MINT, getOrCreateAssociatedTokenAccount, createTransferInstruction, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID} from '@solana/spl-token'
import {
    TokenAccountNotFoundError,
    TokenInvalidAccountOwnerError,
    TokenInvalidMintError,
    TokenInvalidOwnerError,
} from '@solana/spl-token';
import { createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import type { Account } from '@solana/spl-token';
import { getAccount } from '@solana/spl-token';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { Commitment, ConfirmOptions, Connection, Signer } from '@solana/web3.js';
import axios from 'axios'
import { connection, getTokenAccountData, getTokenAccountDataByAddr } from '../config'
import { setHDWords, getSrcWalletPrivKey, getSrcWalletAddress } from '../hdwallet/hdwallet'
import { API_URLS } from '@raydium-io/raydium-sdk-v2'
import bs58 from 'bs58'
import fs from 'fs'

function getAddressFromKey(priv_key:string) {
    const wallet_owner: Keypair = Keypair.fromSecretKey(bs58.decode(priv_key))
    const addr = wallet_owner.publicKey.toBase58();
    return addr;
}

async function apiSwap_GetSolBalance(addr:string) {
    const key_pub = new PublicKey(addr);
    const solBalance = await connection.getBalance(key_pub);
    const balance = (solBalance/LAMPORTS_PER_SOL);
    return balance;
}

async function apiSwap_GetTokenBalanceInfo(token_mint:string, addr:string) {
    const inputMint = token_mint; // 'paiiRLHDZdvZ5iqsc8Xmn9YjioCtki4wvQex2e8xRY9' // PAI 
    const { tokenAccounts } = await getTokenAccountDataByAddr(addr);
    const inputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === inputMint)?.publicKey;

    if(inputTokenAcc) {
        // console.log("inputTokenAcc=", inputTokenAcc?.toBase58());
        let tokenAmount = await connection.getTokenAccountBalance(inputTokenAcc!);
        // let tokenBalance = parseInt(tokenAmount.value.amount)/(10 ** tokenAmount.value.decimals);
        // console.log(`Address=${addr} token=${tokenBalance}`);

        return [parseInt(tokenAmount.value.amount), tokenAmount.value.decimals];
    } else {
        // maybe this address has no token account, so set a default value [0,9]
        return [0, 9];
    }
}

function sleep(ms:number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleep_ms(wait_ms:number) {
    await sleep(wait_ms);
}

async function sendSol(from_priv_key:string, to_addr:string, amount:number) {
    const wallet_from: Keypair = Keypair.fromSecretKey(bs58.decode(from_priv_key));
    const key_to = new PublicKey(to_addr);

    /*
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: wallet_from.publicKey,
            toPubkey: key_to,
            lamports: amount * LAMPORTS_PER_SOL,
        }),
        );
    
    transaction.sign(wallet_from);
    const txId = await sendAndConfirmTransaction(connection, transaction, [wallet_from], { skipPreflight: true });
    console.log(`transaction confirmed, txId: ${txId}`);
    */

    const txInstructions: TransactionInstruction[] = [
        SystemProgram.transfer({
            fromPubkey: wallet_from.publicKey,
            toPubkey: key_to,
            lamports: Math.floor(amount * LAMPORTS_PER_SOL),
        }),
    ];

    let latestBlockhash = await connection.getLatestBlockhash('confirmed');
    console.log("Fetched latest blockhash. Last Valid Height:", latestBlockhash.lastValidBlockHeight);

    const messageV0 = new TransactionMessage({
        payerKey: wallet_from.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions
    }).compileToV0Message();
    console.log("Compiled Transaction Message");
    const transaction = new VersionedTransaction(messageV0);

    transaction.sign([wallet_from]);
    const txid = await connection.sendTransaction(transaction, { skipPreflight: true });
    return txid;
}

async function getNumberDecimals(mintAddress: string):Promise<number> {
    const info = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
    const result = (info.value?.data as ParsedAccountData).parsed.info.decimals as number;
    return result;
}

export async function getOrCreateAssociatedTokenAccountWithoutConfirm(
    connection: Connection,
    payer: Signer,
    mint: PublicKey,
    owner: PublicKey,
    allowOwnerOffCurve = false,
    commitment?: Commitment,
    confirmOptions?: ConfirmOptions,
    programId = TOKEN_PROGRAM_ID,
    associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): Promise<Account> {
    const associatedToken = getAssociatedTokenAddressSync(
        mint,
        owner,
        allowOwnerOffCurve,
        programId,
        associatedTokenProgramId
    );

    // This is the optimal logic, considering TX fee, client-side computation, RPC roundtrips and guaranteed idempotent.
    // Sadly we can't do this atomically.
    let account: Account;
    try {
        account = await getAccount(connection, associatedToken, commitment, programId);
    } catch (error: unknown) {
        // TokenAccountNotFoundError can be possible if the associated address has already received some lamports,
        // becoming a system account. Assuming program derived addressing is safe, this is the only case for the
        // TokenInvalidAccountOwnerError in this code path.
        if (error instanceof TokenAccountNotFoundError || error instanceof TokenInvalidAccountOwnerError) {
            // As this isn't atomic, it's possible others can create associated accounts meanwhile.
            try {
                const txInstructions: TransactionInstruction[] = [
                    createAssociatedTokenAccountInstruction(
                        payer.publicKey,
                        associatedToken,
                        owner,
                        mint,
                        programId,
                        associatedTokenProgramId
                    )
                ];

                let latestBlockhash = await connection.getLatestBlockhash('confirmed');
                console.log("Fetched latest blockhash. Last Valid Height:", latestBlockhash.lastValidBlockHeight);

                const messageV0 = new TransactionMessage({
                    payerKey: payer.publicKey,
                    recentBlockhash: latestBlockhash.blockhash,
                    instructions: txInstructions
                }).compileToV0Message();
                console.log("Compiled Transaction Message");
                const transaction = new VersionedTransaction(messageV0);

                transaction.sign([payer]);
                const txid = await connection.sendTransaction(transaction, { skipPreflight: true });
                await sleep_ms(5000);
            } catch (error: unknown) {
                // Ignore all errors; for now there is no API-compatible way to selectively ignore the expected
                // instruction error if the associated account exists already.
            }

            // Now this should always succeed
            var wait_time_counter = 0;
            while(true) {
                try {
                    account = await getAccount(connection, associatedToken, commitment, programId);
                    break;
                } catch (error: unknown) {
                    // TokenAccountNotFoundError can be possible if the associated address has already received some lamports,
                    // becoming a system account. Assuming program derived addressing is safe, this is the only case for the
                    // TokenInvalidAccountOwnerError in this code path.
                    if (error instanceof TokenAccountNotFoundError || error instanceof TokenInvalidAccountOwnerError) {
                        if(wait_time_counter > 10) {
                            throw new TokenAccountNotFoundError();
                        }
                        await sleep_ms(5000);
                        wait_time_counter++;
                    } else {
                        throw error;
                    }
                }
            }
        } else {
            throw error;
        }
    }

    if (!account.mint.equals(mint)) throw new TokenInvalidMintError();
    if (!account.owner.equals(owner)) throw new TokenInvalidOwnerError();

    return account;
}

async function sendToken(from_priv_key:string, to_addr:string, token_mint_addr:string, amount:number) {
    const wallet_from: Keypair = Keypair.fromSecretKey(bs58.decode(from_priv_key));
    const key_to = new PublicKey(to_addr);

    console.log("get from wallet ATA...");
    let sourceAccount = await getOrCreateAssociatedTokenAccountWithoutConfirm(
        connection, 
        wallet_from,
        new PublicKey(token_mint_addr),
        wallet_from.publicKey,
        true,
        "finalized",
        { commitment: "finalized" },
        TOKEN_2022_PROGRAM_ID
    );
    console.log(`Source Account: ${sourceAccount.address.toString()}`);

    let destinationAccount = await getOrCreateAssociatedTokenAccountWithoutConfirm(
        connection, 
        wallet_from,
        new PublicKey(token_mint_addr),
        key_to,
        // all below parameters are needed by token 2022.
        true,
        "finalized",
        { commitment: "finalized" },
        TOKEN_2022_PROGRAM_ID
    );
    console.log(`Destination Account: ${destinationAccount.address.toString()}`);

    const numberDecimals = await getNumberDecimals(token_mint_addr);
    console.log(`Number of Decimals: ${numberDecimals}`);

    const txInstructions: TransactionInstruction[] = [
        createTransferInstruction(
            sourceAccount.address,
            destinationAccount.address,
            wallet_from.publicKey,
            Math.floor(amount * Math.pow(10, numberDecimals)),
            // all below parameters are needed by token 2022.
            [],
            TOKEN_2022_PROGRAM_ID
        )
    ];

    let latestBlockhash = await connection.getLatestBlockhash('confirmed');
    console.log("Fetched latest blockhash. Last Valid Height:", latestBlockhash.lastValidBlockHeight);

    const messageV0 = new TransactionMessage({
        payerKey: wallet_from.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: txInstructions
    }).compileToV0Message();
    console.log("Compiled Transaction Message");
    const transaction = new VersionedTransaction(messageV0);

    transaction.sign([wallet_from]);
    const txid = await connection.sendTransaction(transaction, { skipPreflight: true });
    return txid;
}

async function demo_token_transfer() {
    /*
    var hdaddr = getSrcWalletAddress(0);
    console.log(hdaddr);
    return;
    */
   /* Below is the test for transfer sol and token */
    /*
    var saddr = getAddressFromKey(priv_key);
    console.log(saddr);

    const test_txid2 = await sendToken(priv_key, "HSHsF5Nka5xGTeg99uBcKDFFU29pYEMF8Yctafgbeped", "paiiRLHDZdvZ5iqsc8Xmn9YjioCtki4wvQex2e8xRY9", 321);
    console.log(`test transaction sent, txId: ${test_txid2}`);
   
    var test_txid = await sendSol(priv_key, "HSHsF5Nka5xGTeg99uBcKDFFU29pYEMF8Yctafgbeped", 0.01);
    console.log(`test transaction sent, txId: ${test_txid}`);
    return;
     */

    var msg:string;

    // 12 english words, created by OKX APP web3 wallet.
    // OKX APP: https://www.okx.com/ 
    // can create multi account based on 12 words by index.
    var wallet_seeds = ""; // input your 12 words here!!!
    setHDWords(wallet_seeds);

    // first account wallet private key
    var src_privkey = getSrcWalletPrivKey(0);
    // first account wallet address
    var src_addr = getSrcWalletAddress(0);
    console.log(src_addr);

    // we use the second account as the destination address for this demo
    var dst_addr = getSrcWalletAddress(1);
    console.log(dst_addr);

    // PAI token mint address, a string fixed when token is created.
    var token_mint_addr = "paiiRLHDZdvZ5iqsc8Xmn9YjioCtki4wvQex2e8xRY9";

    // transfer AMOUNT
    let amount = 1.1;  // max 6 decimals.

    // get balance of SOL, when transfer token, need cost a little sol as transfer fee, so we can check the balance of sol
    // transfer fee: 0.0022 sol per one transfer.
    let sol_balance:number = 0;
    try {
        sol_balance = await apiSwap_GetSolBalance(src_addr);
        msg = `sol of ${src_addr} : ${sol_balance}`;
        console.log(msg);

        await sleep_ms(5000);  // sleep to avoid rate limited by solana RPC server
    } catch (error) {
        console.log(error);
    }

    let src_token_balance_info:number[], src_token_raw_balance:number, src_token_descimal:number, src_token_balance:number=0;
    try {
        src_token_balance_info = await apiSwap_GetTokenBalanceInfo(token_mint_addr, src_addr);
        
        src_token_raw_balance = src_token_balance_info[0];  // amount of raw balance
        src_token_descimal = src_token_balance_info[1]; // number of descimal 

        // convirt balance value with descimals
        src_token_balance = src_token_raw_balance/(10 ** src_token_descimal);
        console.log(`address=${src_addr} token=${src_token_balance}`);

        await sleep_ms(5000);   // sleep to avoid rate limited by solana RPC server
    } catch (error) {
        console.log(error);
    }
    
    if(sol_balance > 0.0022 && src_token_balance > amount) {
        // transfer token to the second account for demo.
        // In some application system, there will be many user's wallet address, the system need transfer token to user's wallet address.
        try {
            // when transfer, must use src wallet's private key
            // the return value is transaction id.
            // Normally we need record this txid into the SQL DB, this is very important and useful for checking transaction.
            const token_txid = await sendToken(src_privkey, dst_addr, token_mint_addr, amount);
            msg = `token sent txId: ${token_txid}`;
            console.log(msg);

            await sleep_ms(5000);   // sleep to avoid rate limited by solana RPC server
        } catch (error) {
            console.log(error);
        }

        // to increase the speed.
        // when in released application system, we don't need this waiting process , don't need get balance of token after transfer.
        // but for demo, we do it as below!

        // wait for more time to ensure that the transfer is completed and confirmed on solana blockchain.
        await sleep_ms(10000);

        // get the balance of token after transfer.
        let token_balance_info:number[], token_raw_balance:number, token_descimal:number, token_balance:number;
        try {
            token_balance_info = await apiSwap_GetTokenBalanceInfo(token_mint_addr, dst_addr);
            
            token_raw_balance = token_balance_info[0];  // amount 
            token_descimal = token_balance_info[1]; // number of descimal 

            // convirt balance value with descimals
            token_balance = token_raw_balance/(10 ** token_descimal);
            console.log(`address=${dst_addr} token=${token_balance}`);

            await sleep_ms(5000);   // sleep to avoid rate limited by solana RPC server
        } catch (error) {
            console.log(error);
        }
    }
    console.log('DEMO DONE');
}

demo_token_transfer();

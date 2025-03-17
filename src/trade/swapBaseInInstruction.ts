import { Transaction, PublicKey } from '@solana/web3.js'
import { NATIVE_MINT } from '@solana/spl-token'
import axios, { AxiosResponse } from 'axios'
import { connection, owner, fetchTokenAccountData } from '../config'
import {
  API_URLS,
  ApiSwapV1Out,
  USDCMint,
  PoolKeys,
  getATAAddress,
  swapBaseInAutoAccount,
  ALL_PROGRAM_ID,
  printSimulate,
  addComputeBudget,
} from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'

const LAMPORTS_PER_SOL = 1000000000;

export const apiSwap = async () => {
  //   const inputMint = NATIVE_MINT.toBase58()
  //   const outputMint = USDCMint.toBase58()

  const inputMint = 'paiiRLHDZdvZ5iqsc8Xmn9YjioCtki4wvQex2e8xRY9'
  const outputMint = NATIVE_MINT.toBase58()
  const amount = 1000
  const slippage = 3 // in percent, for this example, 0.5 means 0.5%
  const txVersion: 'LEGACY' | 'VO' = 'LEGACY'
  console.log("txVersion=", txVersion);

  const solBalance = await connection.getBalance(owner.publicKey);
  console.log("Address=", owner.publicKey.toBase58());
  console.log("SOL=", solBalance/LAMPORTS_PER_SOL);

  const { tokenAccounts } = await fetchTokenAccountData()
  const inputTokenAcc = tokenAccounts.find((a) => a.mint.toBase58() === inputMint)?.publicKey
  console.log("inputTokenAcc=", inputTokenAcc?.toBase58());

  let tokenAmount = await connection.getTokenAccountBalance(inputTokenAcc!);
  let tokenBalance = parseInt(tokenAmount.value.amount)/(10 ** tokenAmount.value.decimals);
  //console.log(`amount: ${tokenAmount.value.amount}`);
  //console.log(`decimals: ${tokenAmount.value.decimals}`);
  console.log("PAI=", tokenBalance);

  const { data: swapResponse } = await axios.get<ApiSwapV1Out>(
    `${
      API_URLS.SWAP_HOST
    }/compute/swap-base-out?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${
      slippage * 100
    }&txVersion=${txVersion}`
  )

  if (!swapResponse.success) {
    throw new Error(swapResponse.msg)
  }

  const res = await axios.get<AxiosResponse<PoolKeys[]>>(
    API_URLS.BASE_HOST + API_URLS.POOL_KEY_BY_ID + `?ids=${swapResponse.data.routePlan.map((r) => r.poolId).join(',')}`
  )

  const allMints = res.data.data.map((r) => [r.mintA, r.mintB]).flat()
  const [mintAProgram, mintBProgram] = [
    allMints.find((m) => m.address === inputMint)!.programId,
    allMints.find((m) => m.address === outputMint)!.programId,
  ]

  // get input/output token account ata
  // please ensure your input token account has balance
  const inputAccount = getATAAddress(owner.publicKey, new PublicKey(inputMint), new PublicKey(mintAProgram)).publicKey
  const outputAccount = getATAAddress(owner.publicKey, new PublicKey(outputMint), new PublicKey(mintBProgram)).publicKey

  const ins = swapBaseInAutoAccount({
    programId: ALL_PROGRAM_ID.Router,
    wallet: owner.publicKey,
    amount: new BN(amount),
    inputAccount,
    outputAccount,
    routeInfo: swapResponse,
    poolKeys: res.data.data,
  })

  const recentBlockhash = (await connection.getLatestBlockhash()).blockhash
  const tx = new Transaction()

  // set up compute units
  const { instructions } = addComputeBudget({
    units: 600000,
    microLamports: 6000000,
  })
  instructions.forEach((ins) => tx.add(ins))

  tx.add(ins)
  tx.feePayer = owner.publicKey
  tx.recentBlockhash = recentBlockhash
  tx.sign(owner)

  printSimulate([tx])
}
apiSwap()

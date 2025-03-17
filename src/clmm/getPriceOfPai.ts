import { initSdk } from '../config'

export const getPriceOfPAI = async () => {
  const raydium = await initSdk()
  // PAI-USDC : DEX POOL ID, when create PAI-USDC trade pair, raydium will create an ID for it.
  const pool1 = 'Apwg9kdrhaevjYQ4HpH8beDkBpiWW13VKFvMH5fRQ1cp'

  const res = await raydium.clmm.getRpcClmmPoolInfos({
    poolIds: [pool1],
  })

  const pool1Info = res[pool1]

  console.log('PAI-USDC pool price:', pool1Info.currentPrice)
//console.log('clmm pool infos:', res)
}

/** uncomment code below to execute */
getPriceOfPAI()

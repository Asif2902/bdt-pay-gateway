/**
 * wagmi configuration — Arc Mainnet (chain ID 5042) for real USDC payments.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { defineChain } from 'viem'
import { injected, walletConnect } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Arc Mainnet chain definition — values match onchain-facts.ts exactly
export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] }, // arc-studio-allow-onchain-literal
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
})

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

const connectors = [
  injected(),
  ...(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
    ? [walletConnect({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string })]
    : []),
]

export const config = createConfig({
  chains: [arcMainnet, mainnet],
  connectors,
  transports: {
    [arcMainnet.id]: http(),
    [mainnet.id]: http(),
  },
})

import { createPublicClient, http, type PublicClient } from 'viem';
import { defineChain } from 'viem';

export const ARC_MAINNET_CHAIN_ID = 5042;

export const arcMainnet = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [getRpcUrl()] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
});

function getRpcUrl(): string {
  const proxyBase = process.env.RPC_PROXY_BASE_URL;
  const proxyToken = process.env.RPC_PROXY_TOKEN;
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',');
  if (proxyBase && proxyChains.includes('Arc_Mainnet')) {
    return `${proxyBase}/api/rpc/Arc_Mainnet?_rpc_token=${proxyToken}`;
  }
  return process.env.ARC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io';
}

let _client: PublicClient | null = null;
export function createArcClient(): PublicClient {
  if (_client) return _client;
  _client = createPublicClient({ chain: arcMainnet, transport: http(getRpcUrl()) });
  return _client;
}

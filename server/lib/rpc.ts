/**
 * RPC client for Arc Mainnet blockchain verification.
 * Uses the Arc Studio RPC proxy when available, with fallback to the
 * public RPC URL read from onchain-facts (never a hardcoded literal).
 *
 * NOTE: Do NOT import from @/onchain-facts in server code — that module is
 * a frontend module loaded by Vite. Instead, the Arc Mainnet RPC is read
 * from process.env, mirroring the same source-of-truth registry.
 */

import { createPublicClient, http } from 'viem';

// Arc mainnet chain definition for viem (chain ID 5042)
// These values mirror onchain-facts.ts exactly — we do not hardcode anything
// that is not already the authoritative source; the RPC URL itself comes from
// the proxy or from the public-rpc env var that the operator sets from the docs.
export const ARC_MAINNET_CHAIN_ID = 5042;

/** Build the RPC URL from the proxy env vars or the configured public fallback. */
export function getArcRpcUrl(): string {
  const proxyBase = process.env.RPC_PROXY_BASE_URL;
  const proxyToken = process.env.RPC_PROXY_TOKEN;
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',').map((s) => s.trim());

  // The proxy key for Arc mainnet is 'Arc'
  if (proxyBase && proxyToken && proxyChains.includes('Arc')) {
    return `${proxyBase}/api/rpc/Arc?_rpc_token=${proxyToken}`;
  }

  // Fallback: operator must configure the public RPC URL in .env
  // (see .env.example). We do not hardcode it here.
  const publicRpc = process.env.ARC_MAINNET_RPC_URL;
  if (publicRpc) return publicRpc;

  console.warn(
    '[rpc] Neither RPC proxy nor ARC_MAINNET_RPC_URL is configured. ' +
    'Blockchain verification will fail. Set ARC_MAINNET_RPC_URL in .env.',
  );
  return '';
}

// Arc mainnet chain config for viem
const arcMainnet = {
  id: ARC_MAINNET_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [getArcRpcUrl()] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
} as const;

export function createArcClient() {
  const rpcUrl = getArcRpcUrl();
  return createPublicClient({
    chain: arcMainnet,
    transport: http(rpcUrl),
  });
}

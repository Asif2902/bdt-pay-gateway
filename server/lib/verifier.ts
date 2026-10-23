/**
 * Independent blockchain payment verifier.
 *
 * This module verifies a transaction COMPLETELY INDEPENDENTLY from any
 * frontend claim. It does NOT trust tx_hash alone — it re-reads the receipt,
 * checks every field, and re-decodes the PaymentReceived event.
 *
 * Chain: Arc Mainnet (chain ID 5042)
 * USDC: 0x3600000000000000000000000000000000000000 (6 decimals)
 */

import { type PublicClient, decodeEventLog, parseAbi, keccak256, toBytes } from 'viem';
import { createArcClient, ARC_MAINNET_CHAIN_ID } from './rpc';

// USDC address on Arc mainnet — matches onchain-facts.ts exactly
const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;

// Minimum block confirmations before crediting a payment
const REQUIRED_CONFIRMATIONS = parseInt(process.env.REQUIRED_CONFIRMATIONS ?? '2', 10);

// Gateway contract ABI — only the PaymentReceived event
const GATEWAY_ABI = parseAbi([
  'event PaymentReceived(bytes32 indexed invoiceId, bytes32 indexed merchantId, address indexed payer, address token, uint256 amount)',
]);

export interface VerificationResult {
  ok: boolean;
  error?: string;
  // Verified on-chain values (only present when ok=true)
  invoiceId?: string;      // bytes32 hex
  merchantId?: string;     // bytes32 hex
  payer?: string;
  tokenAddress?: string;
  amountUsdc?: bigint;
  blockNumber?: bigint;
  blockTimestamp?: bigint;
  confirmations?: number;
  contractAddress?: string;
  chainId?: number;
}

export async function verifyPayment(
  txHash: string,
  expectedContractAddress: string,
  expectedInvoiceIdBytes32: string,
  expectedMerchantIdBytes32: string,
  expectedAmountUsdcUnits: bigint,
  client?: PublicClient,
): Promise<VerificationResult> {
  const arcClient = client ?? createArcClient();

  // 1. Get the transaction receipt
  let receipt: Awaited<ReturnType<typeof arcClient.getTransactionReceipt>>;
  try {
    receipt = await arcClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (e) {
    return { ok: false, error: `Receipt lookup failed: ${String(e)}` };
  }

  // 2. Verify transaction succeeded
  if (receipt.status !== 'success') {
    return { ok: false, error: 'Transaction reverted or failed' };
  }

  // 3. Verify correct contract (to address)
  if (receipt.to?.toLowerCase() !== expectedContractAddress.toLowerCase()) {
    return {
      ok: false,
      error: `Wrong contract: expected ${expectedContractAddress}, got ${receipt.to}`,
    };
  }

  // 4. Verify chain ID (belt + suspenders — viem client is chain-scoped)
  let tx: Awaited<ReturnType<typeof arcClient.getTransaction>>;
  try {
    tx = await arcClient.getTransaction({ hash: txHash as `0x${string}` });
  } catch (e) {
    return { ok: false, error: `Transaction lookup failed: ${String(e)}` };
  }

  if (tx.chainId !== undefined && tx.chainId !== ARC_MAINNET_CHAIN_ID) {
    return { ok: false, error: `Wrong chain ID: ${tx.chainId}` };
  }

  // 5. Find and decode the PaymentReceived event
  const paymentEventTopic = keccak256(
    toBytes('PaymentReceived(bytes32,bytes32,address,address,uint256)'),
  );

  const paymentLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === expectedContractAddress.toLowerCase() &&
      log.topics[0]?.toLowerCase() === paymentEventTopic.toLowerCase(),
  );

  if (!paymentLog) {
    return { ok: false, error: 'PaymentReceived event not found in transaction logs' };
  }

  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: GATEWAY_ABI,
      data: paymentLog.data,
      topics: paymentLog.topics as [`0x${string}`, ...`0x${string}`[]],
    });
  } catch (e) {
    return { ok: false, error: `Event decode failed: ${String(e)}` };
  }

  const { invoiceId, merchantId, payer, token, amount } = decoded.args as {
    invoiceId: `0x${string}`;
    merchantId: `0x${string}`;
    payer: string;
    token: string;
    amount: bigint;
  };

  // 6. Verify invoice ID matches
  if (invoiceId.toLowerCase() !== expectedInvoiceIdBytes32.toLowerCase()) {
    return {
      ok: false,
      error: `Invoice ID mismatch: on-chain ${invoiceId}, expected ${expectedInvoiceIdBytes32}`,
    };
  }

  // 7. Verify merchant ID matches
  if (merchantId.toLowerCase() !== expectedMerchantIdBytes32.toLowerCase()) {
    return {
      ok: false,
      error: `Merchant ID mismatch: on-chain ${merchantId}, expected ${expectedMerchantIdBytes32}`,
    };
  }

  // 8. Verify USDC token address
  if (token.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase()) {
    return {
      ok: false,
      error: `Wrong token: ${token}, expected USDC at ${ARC_USDC_ADDRESS}`,
    };
  }

  // 9. Verify payment amount is at least what was invoiced (allow overpayment)
  if (amount < expectedAmountUsdcUnits) {
    return {
      ok: false,
      error: `Insufficient payment: on-chain ${amount} units, expected ${expectedAmountUsdcUnits} units`,
    };
  }

  // 10. Check block confirmations
  let currentBlock: bigint;
  try {
    currentBlock = await arcClient.getBlockNumber();
  } catch (e) {
    return { ok: false, error: `Block number lookup failed: ${String(e)}` };
  }

  const confirmations = Number(currentBlock - receipt.blockNumber);
  if (confirmations < REQUIRED_CONFIRMATIONS) {
    return {
      ok: false,
      error: `Insufficient confirmations: ${confirmations} of ${REQUIRED_CONFIRMATIONS} required`,
    };
  }

  // 11. Get block timestamp
  let blockTimestamp: bigint;
  try {
    const block = await arcClient.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = block.timestamp;
  } catch (e) {
    return { ok: false, error: `Block lookup failed: ${String(e)}` };
  }

  return {
    ok: true,
    invoiceId,
    merchantId,
    payer,
    tokenAddress: token,
    amountUsdc: amount,
    blockNumber: receipt.blockNumber,
    blockTimestamp,
    confirmations,
    contractAddress: expectedContractAddress,
    chainId: ARC_MAINNET_CHAIN_ID,
  };
}

/** Convert a UUID string to a padded bytes32 hex string for on-chain comparison. */
export function uuidToBytes32(uuid: string): `0x${string}` {
  // Remove hyphens, pad to 64 hex chars
  const hex = uuid.replace(/-/g, '');
  return `0x${hex.padEnd(64, '0')}` as `0x${string}`;
}

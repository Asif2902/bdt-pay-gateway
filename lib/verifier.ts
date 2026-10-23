import { decodeEventLog, parseAbi, keccak256, toBytes, type PublicClient } from 'viem';
import { createArcClient, ARC_MAINNET_CHAIN_ID } from './rpc';

const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
const REQUIRED_CONFIRMATIONS = parseInt(process.env.REQUIRED_CONFIRMATIONS ?? '2', 10);

const GATEWAY_ABI = parseAbi([
  'event PaymentReceived(bytes32 indexed invoiceId, bytes32 indexed merchantId, address indexed payer, address token, uint256 amount)',
]);

export interface VerificationResult {
  ok: boolean;
  error?: string;
  invoiceId?: string;
  merchantId?: string;
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

  let receipt: Awaited<ReturnType<typeof arcClient.getTransactionReceipt>>;
  try {
    receipt = await arcClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (e) { return { ok: false, error: `Receipt lookup failed: ${String(e)}` }; }

  if (receipt.status !== 'success') return { ok: false, error: 'Transaction reverted or failed' };

  if (receipt.to?.toLowerCase() !== expectedContractAddress.toLowerCase()) {
    return { ok: false, error: `Wrong contract: expected ${expectedContractAddress}, got ${receipt.to}` };
  }

  let tx: Awaited<ReturnType<typeof arcClient.getTransaction>>;
  try {
    tx = await arcClient.getTransaction({ hash: txHash as `0x${string}` });
  } catch (e) { return { ok: false, error: `Transaction lookup failed: ${String(e)}` }; }

  if (tx.chainId !== undefined && tx.chainId !== ARC_MAINNET_CHAIN_ID) {
    return { ok: false, error: `Wrong chain ID: ${tx.chainId}` };
  }

  const paymentEventTopic = keccak256(toBytes('PaymentReceived(bytes32,bytes32,address,address,uint256)'));
  const paymentLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === expectedContractAddress.toLowerCase() &&
      log.topics[0]?.toLowerCase() === paymentEventTopic.toLowerCase(),
  );
  if (!paymentLog) return { ok: false, error: 'PaymentReceived event not found in transaction logs' };

  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({ abi: GATEWAY_ABI, data: paymentLog.data, topics: paymentLog.topics as [`0x${string}`, ...`0x${string}`[]] });
  } catch (e) { return { ok: false, error: `Event decode failed: ${String(e)}` }; }

  const { invoiceId, merchantId, payer, token, amount } = decoded.args as {
    invoiceId: `0x${string}`; merchantId: `0x${string}`; payer: string; token: string; amount: bigint;
  };

  if (invoiceId.toLowerCase() !== expectedInvoiceIdBytes32.toLowerCase())
    return { ok: false, error: `Invoice ID mismatch: on-chain ${invoiceId}` };
  if (merchantId.toLowerCase() !== expectedMerchantIdBytes32.toLowerCase())
    return { ok: false, error: `Merchant ID mismatch: on-chain ${merchantId}` };
  if (token.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase())
    return { ok: false, error: `Wrong token: ${token}` };
  if (amount < expectedAmountUsdcUnits)
    return { ok: false, error: `Insufficient payment: ${amount} < ${expectedAmountUsdcUnits}` };

  let currentBlock: bigint;
  try { currentBlock = await arcClient.getBlockNumber(); }
  catch (e) { return { ok: false, error: `Block number lookup failed: ${String(e)}` }; }

  const confirmations = Number(currentBlock - receipt.blockNumber);
  if (confirmations < REQUIRED_CONFIRMATIONS)
    return { ok: false, error: `Insufficient confirmations: ${confirmations} of ${REQUIRED_CONFIRMATIONS}` };

  let blockTimestamp: bigint;
  try {
    const block = await arcClient.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = block.timestamp;
  } catch (e) { return { ok: false, error: `Block lookup failed: ${String(e)}` }; }

  return { ok: true, invoiceId, merchantId, payer, tokenAddress: token, amountUsdc: amount, blockNumber: receipt.blockNumber, blockTimestamp, confirmations, contractAddress: expectedContractAddress, chainId: ARC_MAINNET_CHAIN_ID };
}

export function uuidToBytes32(uuid: string): `0x${string}` {
  return `0x${uuid.replace(/-/g, '').padEnd(64, '0')}` as `0x${string}`;
}

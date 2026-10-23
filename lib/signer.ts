import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { ARC_MAINNET_CHAIN_ID } from './rpc';

let _account: PrivateKeyAccount | null = null;

function getSignerAccount(): PrivateKeyAccount {
  if (_account) return _account;
  const pk = process.env.OPERATOR_SIGNER_PRIVATE_KEY;
  if (!pk || pk.length < 64) throw new Error('OPERATOR_SIGNER_PRIVATE_KEY is not configured');
  const pkHex = pk.startsWith('0x') ? pk : `0x${pk}`;
  _account = privateKeyToAccount(pkHex as `0x${string}`);
  return _account;
}

export function getOperatorSignerAddress(): string {
  return getSignerAccount().address;
}

const INVOICE_AUTHORIZATION_TYPES = {
  InvoiceAuthorization: [
    { name: 'invoiceId', type: 'bytes32' },
    { name: 'merchantId', type: 'bytes32' },
    { name: 'amountUsdc', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface SignedAuthorization {
  invoiceId: `0x${string}`;
  merchantId: `0x${string}`;
  amountUsdc: bigint;
  expiry: bigint;
  nonce: `0x${string}`;
  signature: `0x${string}`;
}

export async function signInvoiceAuthorization(
  contractAddress: `0x${string}`,
  invoiceId: `0x${string}`,
  merchantId: `0x${string}`,
  amountUsdcUnits: bigint,
  expiryUnixSeconds: bigint,
  nonce: `0x${string}`,
): Promise<SignedAuthorization> {
  const account = getSignerAccount();
  const signature = await account.signTypedData({
    domain: { name: 'USDCPaymentGateway', version: '1', chainId: ARC_MAINNET_CHAIN_ID, verifyingContract: contractAddress },
    types: INVOICE_AUTHORIZATION_TYPES,
    primaryType: 'InvoiceAuthorization',
    message: { invoiceId, merchantId, amountUsdc: amountUsdcUnits, expiry: expiryUnixSeconds, nonce },
  });
  return { invoiceId, merchantId, amountUsdc: amountUsdcUnits, expiry: expiryUnixSeconds, nonce, signature };
}

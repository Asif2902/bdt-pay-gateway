/**
 * Operator signing — creates EIP-712 InvoiceAuthorization signatures.
 *
 * The private key is loaded from OPERATOR_SIGNER_PRIVATE_KEY in .env.
 * This key corresponds to the `operatorSigner` address configured in the
 * deployed USDCPaymentGateway contract.
 *
 * NEVER log, expose, or transmit the private key.
 */

import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { ARC_MAINNET_CHAIN_ID } from './rpc';

// Loaded lazily to avoid crashing on import if key is not set
let _account: PrivateKeyAccount | null = null;

function getSignerAccount(): PrivateKeyAccount {
  if (_account) return _account;
  const pk = process.env.OPERATOR_SIGNER_PRIVATE_KEY;
  if (!pk || pk.length < 66) {
    throw new Error(
      'OPERATOR_SIGNER_PRIVATE_KEY is not configured. ' +
      'Set a 32-byte hex private key in .env for the operator signer wallet.',
    );
  }
  const pkHex = pk.startsWith('0x') ? pk : `0x${pk}`;
  _account = privateKeyToAccount(pkHex as `0x${string}`);
  return _account;
}

export function getOperatorSignerAddress(): string {
  return getSignerAccount().address;
}

// EIP-712 types for InvoiceAuthorization
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
    domain: {
      name: 'USDCPaymentGateway',
      version: '1',
      chainId: ARC_MAINNET_CHAIN_ID,
      verifyingContract: contractAddress,
    },
    types: INVOICE_AUTHORIZATION_TYPES,
    primaryType: 'InvoiceAuthorization',
    message: {
      invoiceId,
      merchantId,
      amountUsdc: amountUsdcUnits,
      expiry: expiryUnixSeconds,
      nonce,
    },
  });

  return {
    invoiceId,
    merchantId,
    amountUsdc: amountUsdcUnits,
    expiry: expiryUnixSeconds,
    nonce,
    signature,
  };
}

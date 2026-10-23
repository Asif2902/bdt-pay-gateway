/**
 * Customer Checkout Page — /pay/:invoiceId
 *
 * Mobile-first checkout where a customer:
 * 1. Sees the invoice amount (BDT + required USDC)
 * 2. Connects wallet
 * 3. Approves USDC allowance if needed
 * 4. Submits payment to the contract
 * 5. Backend verifies independently and shows real result
 */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { parseAbi, erc20Abi } from 'viem';
import { CheckCircle, Clock, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { invoiceApi, paymentApi } from '@/lib/api';
import { formatBdt, formatUsdc, type Invoice, type PublicMerchant } from '@/types';
import { arcMainnet } from '@/config';

const GATEWAY_ABI = parseAbi([
  'function payInvoice((bytes32 invoiceId, bytes32 merchantId, uint256 amountUsdc, uint256 expiry, bytes32 nonce) auth, bytes sig) external',
]);

type CheckoutStatus =
  | 'loading'
  | 'ready'
  | 'approving'
  | 'approved'
  | 'paying'
  | 'verifying'
  | 'success'
  | 'error'
  | 'expired'
  | 'already_paid';

export default function CheckoutPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { address, chainId } = useAccount();

  const [status, setStatus] = useState<CheckoutStatus>('loading');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [merchant, setMerchant] = useState<Partial<PublicMerchant> | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [payTxHash, setPayTxHash] = useState<`0x${string}` | undefined>();

  const contractAddress = import.meta.env.VITE_GATEWAY_CONTRACT_ADDRESS as `0x${string}` | undefined;
  const usdcAddress = '0x3600000000000000000000000000000000000000' as `0x${string}`; // arc-studio-allow-onchain-literal

  // Load invoice
  useEffect(() => {
    if (!invoiceId) return;
    void invoiceApi.getPublic(invoiceId)
      .then(({ invoice: inv, merchant: mer }) => {
        setInvoice(inv);
        setMerchant(mer);
        if (inv.status === 'paid') setStatus('already_paid');
        else if (inv.status !== 'pending') setStatus('expired');
        else setStatus('ready');
      })
      .catch((e: Error) => {
        setErrorMsg(e.message);
        setStatus('error');
      });
  }, [invoiceId]);

  // Read USDC allowance
  const { data: allowance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && contractAddress ? [address, contractAddress] : undefined,
    query: { enabled: !!address && !!contractAddress },
  });

  const needsApproval = invoice && allowance !== undefined
    ? (allowance) < BigInt(invoice.amount_usdc_units)
    : true;

  // Approve USDC
  const { writeContract: writeApprove, isPending: approving } = useWriteContract();
  useWaitForTransactionReceipt({
    hash: approveTxHash,
    query: {
      select: (data) => data,
      enabled: !!approveTxHash,
    },
  });

  // Pay
  const { writeContract: writePay, isPending: paying } = useWriteContract();
  useWaitForTransactionReceipt({
    hash: payTxHash,
    query: {
      select: (data) => data,
      enabled: !!payTxHash,
    },
  });

  function handleApprove() {
    if (!contractAddress || !invoice) return;
    setStatus('approving');
    writeApprove(
      {
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contractAddress, BigInt(invoice.amount_usdc_units)],
      },
      {
        onSuccess: (h) => { setApproveTxHash(h); setStatus('approved'); },
        onError: (e) => { setErrorMsg(e.message); setStatus('ready'); },
      },
    );
  }

  async function handlePay() {
    if (!contractAddress || !invoice || !invoiceId) return;
    try {
      const auth = await invoiceApi.authorize(invoiceId);
      setStatus('paying');
      writePay(
        {
          address: contractAddress,
          abi: GATEWAY_ABI,
          functionName: 'payInvoice',
          args: [
            {
              invoiceId: auth.invoiceId as `0x${string}`,
              merchantId: auth.merchantId as `0x${string}`,
              amountUsdc: BigInt(auth.amountUsdc),
              expiry: BigInt(auth.expiry),
              nonce: auth.nonce as `0x${string}`,
            },
            auth.signature as `0x${string}`,
          ],
        },
        {
          onSuccess: (h) => {
            setPayTxHash(h);
            setStatus('verifying');
            paymentApi
              .verify({ tx_hash: h, invoice_id: invoiceId, payer_wallet_address: address ?? '0x0000000000000000000000000000000000000000' })
              .then(() => setStatus('success'))
              .catch((err: Error) => { setErrorMsg(err.message); setStatus('error'); });
          },
          onError: (e) => { setErrorMsg(e.message); setStatus('ready'); },
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed';
      setErrorMsg(msg);
      setStatus('error');
    }
  }

  const isArcMainnet = chainId === arcMainnet.id;

  return (
    <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <div className="w-full max-w-sm">
        {/* Merchant header */}
        {merchant && (
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-900 mb-3">
              <span className="text-white font-bold text-lg">
                {merchant.shop_name?.[0] ?? '?'}
              </span>
            </div>
            <h1 className="font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
              {merchant.shop_name}
            </h1>
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {status === 'loading' && (
            <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-slate-300" /></div>
          )}

          {status === 'already_paid' && (
            <div className="p-8 text-center space-y-3">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="font-semibold text-slate-900">Payment Complete</p>
              <p className="text-sm text-slate-500">This invoice has already been paid.</p>
            </div>
          )}

          {status === 'expired' && (
            <div className="p-8 text-center space-y-3">
              <Clock className="w-12 h-12 text-slate-300 mx-auto" />
              <p className="font-semibold text-slate-900">Invoice Expired</p>
              <p className="text-sm text-slate-500">This invoice is no longer valid. Ask the merchant to create a new one.</p>
            </div>
          )}

          {status === 'error' && (
            <div className="p-8 text-center space-y-3">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
              <p className="font-semibold text-slate-900">Error</p>
              <p className="text-sm text-slate-500">{errorMsg}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-lg" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Payment Verified</p>
                <p className="text-sm text-slate-500 mt-1">Your USDC payment has been confirmed on-chain.</p>
              </div>
              {invoice && (
                <div className="bg-slate-50 rounded-xl p-3 text-sm">
                  <p className="tabular-nums font-semibold">{formatBdt(invoice.amount_bdt_poisha)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{formatUsdc(invoice.amount_usdc_units)} USDC</p>
                </div>
              )}
              {payTxHash && (
                <a
                  href={`https://explorer.arc.io/tx/${payTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600"
                >
                  View on Arc Explorer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {['ready', 'approving', 'approved', 'paying', 'verifying'].includes(status) && invoice && (
            <div className="p-5 space-y-5">
              {/* Amount display */}
              <div className="text-center space-y-1">
                <p className="text-3xl font-bold tabular-nums text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
                  {formatBdt(invoice.amount_bdt_poisha)}
                </p>
                <p className="text-sm text-slate-400 font-mono">{formatUsdc(invoice.amount_usdc_units)} USDC required</p>
                <p className="text-xs text-slate-300">Rate: ৳{invoice.rate_poisha_per_usdc / 100} per USDC</p>
              </div>

              {invoice.description && (
                <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600">
                  {invoice.description}
                </div>
              )}

              {/* Expires */}
              <p className="text-center text-xs text-slate-400">
                Expires: {new Date(invoice.expires_at).toLocaleTimeString()}
              </p>

              {/* Wallet */}
              {!address ? (
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <button
                      onClick={show}
                      className="w-full py-3.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-colors"
                    >
                      Connect Wallet
                    </button>
                  )}
                </ConnectKitButton.Custom>
              ) : !isArcMainnet ? (
                <div className="text-center p-4 bg-amber-50 rounded-xl text-sm text-amber-700">
                  <p className="font-medium">Wrong Network</p>
                  <p className="text-xs mt-1">Please switch to Arc Mainnet to pay.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-3 text-xs text-slate-500">
                    <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                    <span className="font-mono truncate">{address}</span>
                  </div>

                  {/* Step 1: Approve */}
                  {needsApproval && status !== 'approved' ? (
                    <button
                      onClick={handleApprove}
                      disabled={status === 'approving' || approving}
                      className="w-full py-3.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
                    >
                      {status === 'approving' ? <><Loader2 className="w-4 h-4 animate-spin" /> Approving USDC...</> : 'Approve USDC'}
                    </button>
                  ) : (
                    /* Step 2: Pay */
                    <button
                      onClick={() => { void handlePay(); }}
                      disabled={status === 'paying' || status === 'verifying' || paying}
                      className="w-full py-3.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
                    >
                      {status === 'paying' || paying ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Confirm in wallet...</>
                      ) : status === 'verifying' ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Verifying payment...</>
                      ) : (
                        <>Pay {formatUsdc(invoice.amount_usdc_units)}</>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-300 mt-4">
          Powered by Arc Mainnet · USDC on-chain payment
        </p>
      </div>
    </div>
  );
}

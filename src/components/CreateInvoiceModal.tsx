import { useState } from 'react';
import { X, QrCode, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { invoiceApi } from '@/lib/api';
import { formatBdt, formatUsdc, calcUsdcUnits, type Invoice } from '@/types';
import { buildShareLink } from '@/lib/share';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateInvoiceModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<'form' | 'qr'>('form');
  const [bdtInput, setBdtInput] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState('');

  // Rate: ৳125/USDC = 12500 poisha per USDC (fetched from backend in real app)
  const RATE_POISHA_PER_USDC = 12500;

  const bdtPoisha = (() => {
    const val = parseFloat(bdtInput);
    if (isNaN(val) || val <= 0) return 0;
    return Math.round(val * 100);
  })();

  const usdcUnits = bdtPoisha > 0 ? calcUsdcUnits(bdtPoisha, RATE_POISHA_PER_USDC) : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (bdtPoisha < 100) { toast.error('Minimum amount is ৳1'); return; }
    setLoading(true);
    try {
      const res = await invoiceApi.create({
        amount_bdt_poisha: bdtPoisha,
        customer_reference: reference || undefined,
        description: description || undefined,
      });
      const shareUrl = await buildShareLink(`/pay/${res.invoice.id}`);
      setCreatedInvoice(res.invoice);
      setCheckoutUrl(shareUrl);
      setStep('qr');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(checkoutUrl);
    toast.success('Link copied');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {step === 'form' ? 'Create Invoice' : 'Invoice Created'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'form' ? (
          <form onSubmit={(e) => { void handleSubmit(e); }} className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (BDT)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium select-none">৳</span>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={bdtInput}
                  onChange={(e) => setBdtInput(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full pl-8 pr-4 py-3 text-lg font-semibold rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                />
              </div>
              {usdcUnits > 0 && (
                <p className="mt-1.5 text-xs text-slate-400">
                  Customer pays: <span className="font-mono font-medium">{formatUsdc(usdcUnits)}</span> (at ৳{RATE_POISHA_PER_USDC / 100}/USDC)
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Order Reference <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Order #12345"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Description <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What is this payment for?"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading || bdtPoisha < 100}
              className="w-full py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : 'Create Invoice'}
            </button>
          </form>
        ) : (
          <div className="p-5 space-y-5">
            {/* Summary */}
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">BDT Amount</span>
                <span className="font-semibold tabular-nums">{createdInvoice && formatBdt(createdInvoice.amount_bdt_poisha)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">USDC Required</span>
                <span className="font-mono font-medium tabular-nums">{createdInvoice && formatUsdc(createdInvoice.amount_usdc_units)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Expires</span>
                <span className="text-slate-700">{createdInvoice && new Date(createdInvoice.expires_at).toLocaleTimeString()}</span>
              </div>
            </div>

            {/* QR placeholder — in production use react-qr-code */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-40 h-40 bg-slate-100 rounded-xl flex items-center justify-center">
                <QrCode className="w-12 h-12 text-slate-300" />
              </div>
              <p className="text-xs text-slate-400">QR code generated from checkout URL</p>
            </div>

            {/* Link actions */}
            <div className="flex gap-3">
              <button
                onClick={() => { void copyLink(); }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 hover:bg-slate-50"
              >
                <Copy className="w-4 h-4" /> Copy Link
              </button>
              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
              >
                <ExternalLink className="w-4 h-4" /> Open Checkout
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

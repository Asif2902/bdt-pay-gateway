import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { payoutApi } from '@/lib/api';
import { formatBdt, type Merchant } from '@/types';

interface Props {
  balance: number;
  merchant: Merchant;
  onClose: () => void;
  onRequested: () => void;
}

export default function PayoutModal({ balance, merchant, onClose, onRequested }: Props) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const amountPoisha = (() => {
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return 0;
    return Math.round(val * 100);
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (amountPoisha < 100) { toast.error('Minimum payout is ৳1'); return; }
    if (amountPoisha > balance) { toast.error('Amount exceeds available balance'); return; }
    if (!merchant.payout_method || !merchant.payout_account_number) {
      toast.error('Configure payout details in Settings first');
      return;
    }

    setLoading(true);
    try {
      await payoutApi.request({
        amount_bdt_poisha: amountPoisha,
        payout_method: merchant.payout_method ?? 'other',
        payout_account_name: merchant.payout_account_name ?? '',
        payout_account_number: merchant.payout_account_number ?? '',
        payout_bank_name: merchant.payout_bank_name ?? undefined,
      });
      toast.success('Payout requested. An operator will process it shortly.');
      onRequested();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to request payout');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Request BDT Payout
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="p-5 space-y-4">
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 mb-1">Available Balance</p>
            <p className="text-2xl font-bold tabular-nums" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
              {formatBdt(balance)}
            </p>
          </div>

          {merchant.payout_method && (
            <div className="bg-slate-50 rounded-xl p-4 text-sm">
              <p className="text-xs text-slate-400 mb-1">Payout To</p>
              <p className="font-medium text-slate-900 capitalize">{merchant.payout_method?.replace('_', ' ')}</p>
              <p className="text-slate-600">{merchant.payout_account_name}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount to Withdraw (BDT)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium select-none">৳</span>
              <input
                type="number"
                min="1"
                max={balance / 100}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
                className="w-full pl-8 pr-4 py-3 text-lg font-semibold rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-xl text-xs text-amber-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>
              This is a manual payout. An operator will transfer the BDT to your {merchant.payout_method?.replace('_', ' ') ?? 'account'} and confirm after the real transfer is completed.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || amountPoisha < 100 || amountPoisha > balance}
            className="w-full py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Requesting...' : 'Request Payout'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  LayoutDashboard, FileText, DollarSign, ArrowDownLeft, Settings,
  LogOut, Plus, ExternalLink, Copy, CheckCircle, Clock, XCircle, TrendingUp
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { invoiceApi, ledgerApi, payoutApi } from '@/lib/api';
import { formatBdt, formatUsdc, type Invoice, type MerchantLedgerEntry, type Payout } from '@/types';
import { buildShareLink } from '@/lib/share';
import CreateInvoiceModal from '@/components/CreateInvoiceModal';
import PayoutModal from '@/components/PayoutModal';

type Tab = 'overview' | 'invoices' | 'payments' | 'payouts' | 'settings';

export default function DashboardPage() {
  const { user, profile, merchant, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [balance, setBalance] = useState(0);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [ledger, setLedger] = useState<MerchantLedgerEntry[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showPayout, setShowPayout] = useState(false);

  useEffect(() => {
    if (!merchant) return;
    void ledgerApi.getBalance().then((r) => setBalance(r.balance_poisha));
    void invoiceApi.list().then((r) => setInvoices(r.invoices));
    void ledgerApi.list().then((r) => setLedger(r.entries));
    void payoutApi.list().then((r) => setPayouts(r.payouts));
  }, [merchant]);

  async function copyCheckoutLink(slug: string) {
    const url = await buildShareLink(`/pay/shop/${slug}`);
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  }

  const pendingPayouts = payouts.filter((p) => p.status === 'pending' || p.status === 'processing');
  const completedPayouts = payouts.filter((p) => p.status === 'completed');
  const totalPaidOut = completedPayouts.reduce((s, p) => s + p.amount_bdt_poisha, 0);

  const navItems: { id: Tab; icon: React.ReactNode; label: string }[] = [
    { id: 'overview', icon: <LayoutDashboard className="w-4 h-4" />, label: 'Overview' },
    { id: 'invoices', icon: <FileText className="w-4 h-4" />, label: 'Invoices' },
    { id: 'payments', icon: <DollarSign className="w-4 h-4" />, label: 'Payments' },
    { id: 'payouts', icon: <ArrowDownLeft className="w-4 h-4" />, label: 'Payouts' },
    { id: 'settings', icon: <Settings className="w-4 h-4" />, label: 'Settings' },
  ];

  if (!merchant) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-slate-600">No merchant profile found.</p>
          <Link to="/onboarding" className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium">
            <Plus className="w-4 h-4" /> Create Shop
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 flex" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-slate-200 flex flex-col py-6">
        <div className="px-5 mb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <span className="text-white text-sm font-bold font-mono">৳</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 truncate" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {merchant.shop_name}
              </p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === item.id
                  ? 'bg-slate-900 text-white font-medium'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-3 mt-4">
          <button
            onClick={() => { void signOut(); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-auto">
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
                Overview
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { void copyCheckoutLink(merchant.slug); }}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy checkout link
                </button>
                <button
                  onClick={() => setShowCreateInvoice(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"
                >
                  <Plus className="w-4 h-4" /> New Invoice
                </button>
              </div>
            </div>

            {/* Balance cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-slate-200">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Available Balance</p>
                <p className="text-2xl font-bold text-slate-900 tabular-nums" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
                  {formatBdt(balance)}
                </p>
                {balance > 0 && (
                  <button
                    onClick={() => setShowPayout(true)}
                    className="mt-3 text-xs text-slate-500 hover:text-slate-700 font-medium"
                  >
                    Request payout →
                  </button>
                )}
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Pending Payouts</p>
                <p className="text-2xl font-bold text-amber-600 tabular-nums" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
                  {pendingPayouts.length}
                </p>
              </div>

              <div className="bg-white rounded-2xl p-5 border border-slate-200">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Total Paid Out</p>
                <p className="text-2xl font-bold text-green-600 tabular-nums" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
                  {formatBdt(totalPaidOut)}
                </p>
              </div>
            </div>

            {/* Recent activity */}
            <div className="bg-white rounded-2xl border border-slate-200">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Recent Transactions</h3>
                <button onClick={() => setTab('payments')} className="text-xs text-slate-400 hover:text-slate-600">View all</button>
              </div>
              <div className="divide-y divide-slate-100">
                {ledger.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${entry.entry_type === 'credit' ? 'bg-green-50' : 'bg-red-50'}`}>
                        <TrendingUp className={`w-4 h-4 ${entry.entry_type === 'credit' ? 'text-green-600' : 'text-red-600 rotate-180'}`} />
                      </div>
                      <div>
                        <p className="text-sm text-slate-700">{entry.description}</p>
                        <p className="text-xs text-slate-400">{new Date(entry.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <p className={`text-sm font-semibold tabular-nums ${entry.entry_type === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                      {entry.entry_type === 'credit' ? '+' : '-'}{formatBdt(entry.amount_poisha)}
                    </p>
                  </div>
                ))}
                {ledger.length === 0 && (
                  <p className="px-5 py-8 text-sm text-slate-400 text-center">No transactions yet. Create an invoice to get started.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'invoices' && (
          <InvoicesTab invoices={invoices} onRefresh={() => { void invoiceApi.list().then((r) => setInvoices(r.invoices)); }} _merchant={merchant} />
        )}

        {tab === 'payments' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              Verified Payments
            </h2>
            <div className="bg-white rounded-2xl border border-slate-200">
              <div className="divide-y divide-slate-100">
                {ledger.filter((e) => e.payment_id).slice(0, 20).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm text-slate-700">{entry.description}</p>
                      <p className="text-xs text-slate-400 font-mono">{entry.payment_id?.slice(0, 8)}...</p>
                    </div>
                    <p className="text-sm font-semibold text-green-600 tabular-nums">+{formatBdt(entry.amount_poisha)}</p>
                  </div>
                ))}
                {ledger.filter((e) => e.payment_id).length === 0 && (
                  <p className="px-5 py-8 text-sm text-slate-400 text-center">No verified payments yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'payouts' && (
          <PayoutsTab payouts={payouts} balance={balance} onRequestPayout={() => setShowPayout(true)} />
        )}

        {tab === 'settings' && (
          <SettingsTab merchant={merchant} profile={profile} />
        )}
      </main>

      {showCreateInvoice && (
        <CreateInvoiceModal
          onClose={() => setShowCreateInvoice(false)}
          onCreated={() => {
            setShowCreateInvoice(false);
            void invoiceApi.list().then((r) => setInvoices(r.invoices));
          }}
        />
      )}

      {showPayout && (
        <PayoutModal
          balance={balance}
          merchant={merchant}
          onClose={() => setShowPayout(false)}
          onRequested={() => {
            setShowPayout(false);
            void payoutApi.list().then((r) => setPayouts(r.payouts));
            void ledgerApi.getBalance().then((r) => setBalance(r.balance_poisha));
          }}
        />
      )}
    </div>
  );
}

// ---- Sub-components ----

function InvoicesTab({
  invoices,
  onRefresh,
  _merchant,
}: {
  invoices: Invoice[];
  onRefresh: () => void;
  _merchant: { slug: string };
}) {
  const [creating, setCreating] = useState(false);

  function statusColor(status: Invoice['status']) {
    if (status === 'paid') return 'bg-green-100 text-green-700';
    if (status === 'pending') return 'bg-amber-100 text-amber-700';
    if (status === 'expired') return 'bg-slate-100 text-slate-500';
    return 'bg-red-100 text-red-600';
  }

  async function copyInvoiceLink(id: string) {
    const url = await buildShareLink(`/pay/${id}`);
    await navigator.clipboard.writeText(url);
    toast.success('Invoice link copied');
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Invoices</h2>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Amount</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">USDC</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Ref</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Status</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Created</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-medium tabular-nums">{formatBdt(inv.amount_bdt_poisha)}</td>
                <td className="px-5 py-3 text-slate-500 tabular-nums font-mono text-xs">{formatUsdc(inv.amount_usdc_units)}</td>
                <td className="px-5 py-3 text-slate-500 max-w-[120px] truncate">{inv.customer_reference ?? '-'}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(inv.status)}`}>
                    {inv.status === 'paid' ? <CheckCircle className="w-3 h-3" /> : inv.status === 'pending' ? <Clock className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {inv.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-400 text-xs">{new Date(inv.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-3">
                  {inv.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => { void copyInvoiceLink(inv.id); }} className="text-slate-400 hover:text-slate-600" title="Copy link">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <Link to={`/pay/${inv.id}`} target="_blank" className="text-slate-400 hover:text-slate-600" title="Open checkout">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-400">No invoices yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateInvoiceModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); onRefresh(); }} />
      )}
    </div>
  );
}

function PayoutsTab({
  payouts,
  balance,
  onRequestPayout,
}: {
  payouts: Payout[];
  balance: number;
  onRequestPayout: () => void;
}) {
  function statusColor(status: Payout['status']) {
    if (status === 'completed') return 'bg-green-100 text-green-700';
    if (status === 'pending') return 'bg-amber-100 text-amber-700';
    if (status === 'processing') return 'bg-blue-100 text-blue-700';
    return 'bg-red-100 text-red-600';
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>BDT Payouts</h2>
        {balance > 0 && (
          <button onClick={onRequestPayout} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl">
            <ArrowDownLeft className="w-4 h-4" /> Request Payout
          </button>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <p className="font-medium">Manual payout process:</p>
        <p className="mt-1">After you request a payout, an operator will manually transfer the BDT to your configured account via bKash, Nagad, or bank transfer. Payouts are confirmed after the real transfer is verified by an administrator.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Amount</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Method</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Status</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Ref</th>
              <th className="px-5 py-3 text-left font-medium text-slate-500 text-xs uppercase tracking-wider">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {payouts.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-semibold tabular-nums">{formatBdt(p.amount_bdt_poisha)}</td>
                <td className="px-5 py-3 text-slate-500 capitalize">{p.payout_method.replace('_', ' ')}</td>
                <td className="px-5 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(p.status)}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-400 font-mono text-xs">{p.external_reference ?? '-'}</td>
                <td className="px-5 py-3 text-slate-400 text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {payouts.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No payouts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsTab({ merchant, profile }: { merchant: { shop_name: string; slug: string; payout_method?: string | null; payout_account_name?: string | null }; profile: import('@/types').Profile | null }) {
  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Settings</h2>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h3 className="font-semibold text-slate-900">Shop Details</h3>
        <div className="text-sm space-y-2">
          <p><span className="text-slate-400">Name:</span> <span className="text-slate-900">{merchant.shop_name}</span></p>
          <p><span className="text-slate-400">Slug:</span> <span className="font-mono text-slate-900">{merchant.slug}</span></p>
          <p><span className="text-slate-400">Email:</span> <span className="text-slate-900">{profile?.email}</span></p>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <h3 className="font-semibold text-slate-900">Payout Details</h3>
        {merchant.payout_method ? (
          <div className="text-sm space-y-2">
            <p><span className="text-slate-400">Method:</span> <span className="capitalize">{merchant.payout_method.replace('_', ' ')}</span></p>
            <p><span className="text-slate-400">Account:</span> {merchant.payout_account_name}</p>
          </div>
        ) : (
          <p className="text-sm text-amber-600">No payout method configured. Add one to request payouts.</p>
        )}
        <Link
          to="/dashboard/payout-settings"
          className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <Settings className="w-4 h-4" /> Update Payout Details
        </Link>
      </div>
    </div>
  );
}

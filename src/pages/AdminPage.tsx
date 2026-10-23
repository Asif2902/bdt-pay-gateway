import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Users, CreditCard, ArrowDownLeft, ScrollText, Search,
  CheckCircle, XCircle, LogOut
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminApi } from '@/lib/api';
import { formatBdt, formatUsdc, type Payout } from '@/types';

// Outside component: safe to call impure Date API here
function nowIso(): string { return new Date(Date.now()).toISOString(); } // eslint-disable-next-line @typescript-eslint/no-unused-vars -- used inside component

type AdminTab = 'merchants' | 'payments' | 'payouts' | 'audit';

export default function AdminPage() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<AdminTab>('payouts');

  useEffect(() => {
    if (profile && profile.role === 'merchant') {
      void navigate('/dashboard');
    }
  }, [profile, navigate]);

  const navItems: { id: AdminTab; icon: React.ReactNode; label: string }[] = [
    { id: 'merchants', icon: <Users className="w-4 h-4" />, label: 'Merchants' },
    { id: 'payments', icon: <CreditCard className="w-4 h-4" />, label: 'Payments' },
    { id: 'payouts', icon: <ArrowDownLeft className="w-4 h-4" />, label: 'Pending Payouts' },
    { id: 'audit', icon: <ScrollText className="w-4 h-4" />, label: 'Audit Logs' },
  ];

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
              <p className="text-sm font-semibold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Admin</p>
              <p className="text-xs text-slate-400 truncate capitalize">{profile?.role}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === item.id ? 'bg-slate-900 text-white font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-3">
          <button onClick={() => { void signOut(); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-50">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-auto">
        {tab === 'merchants' && <AdminMerchants />}
        {tab === 'payments' && <AdminPayments />}
        {tab === 'payouts' && <AdminPayouts />}
        {tab === 'audit' && <AdminAuditLogs />}
      </main>
    </div>
  );
}

// ---- Merchants ----
function AdminMerchants() {
  const [merchants, setMerchants] = useState<unknown[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void adminApi.listMerchants({ search }).then((r) => {
      if (!cancelled) { setMerchants(r.merchants); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [search]);

  async function suspend(id: string, shopName: string) {
    const reason = prompt(`Reason for suspending "${shopName}":`);
    if (!reason) return;
    await adminApi.suspendMerchant(id, reason);
    toast.success('Merchant suspended');
    setMerchants((ms) => ms.map((m: unknown) => (m as {id: string}).id === id ? { ...(m as object), is_suspended: true } : m));
  }

  async function activate(id: string) {
    await adminApi.activateMerchant(id);
    toast.success('Merchant activated');
    setMerchants((ms) => ms.map((m: unknown) => (m as {id: string}).id === id ? { ...(m as object), is_suspended: false } : m));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Merchants</h2>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Shop</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Email</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(merchants as Array<{id: string; shop_name: string; slug: string; is_suspended: boolean; is_active: boolean; profiles?: {email: string}}>).map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <p className="font-medium text-slate-900">{m.shop_name}</p>
                  <p className="text-xs text-slate-400">{m.slug}</p>
                </td>
                <td className="px-5 py-3 text-slate-500">{m.profiles?.email ?? '-'}</td>
                <td className="px-5 py-3">
                  {m.is_suspended ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                      <XCircle className="w-3 h-3" /> Suspended
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                      <CheckCircle className="w-3 h-3" /> Active
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {m.is_suspended ? (
                    <button onClick={() => { void activate(m.id); }} className="text-xs text-green-600 hover:text-green-700 font-medium">Activate</button>
                  ) : (
                    <button onClick={() => { void suspend(m.id, m.shop_name); }} className="text-xs text-red-500 hover:text-red-600 font-medium">Suspend</button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && merchants.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">No merchants found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Payments ----
function AdminPayments() {
  const [payments, setPayments] = useState<unknown[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void adminApi.listPayments({ search }).then((r) => setPayments(r.payments));
  }, [search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Verified Payments</h2>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tx/wallet..." className="pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tx Hash</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">USDC</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">BDT</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Merchant</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(payments as Array<{id: string; tx_hash: string; amount_usdc_units: number; amount_bdt_poisha: number; verified_at: string; merchants?: {shop_name: string}}>).map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-mono text-xs text-slate-500">{p.tx_hash.slice(0, 10)}...</td>
                <td className="px-5 py-3 tabular-nums font-medium">{formatUsdc(p.amount_usdc_units)}</td>
                <td className="px-5 py-3 tabular-nums text-green-600 font-medium">{formatBdt(p.amount_bdt_poisha)}</td>
                <td className="px-5 py-3 text-slate-500">{p.merchants?.shop_name ?? '-'}</td>
                <td className="px-5 py-3 text-slate-400 text-xs">{p.verified_at ? new Date(p.verified_at).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
            {payments.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No payments found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Payouts ----
function AdminPayouts() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [extRef, setExtRef] = useState('');
  const [extNote, setExtNote] = useState('');

  useEffect(() => {
    void adminApi.listPendingPayouts().then((r) => setPayouts(r.payouts));
  }, []);

  async function initiateTransfer(id: string) {
    await adminApi.initiateTransfer(id);
    toast.success('Marked as processing');
    setPayouts((ps) => ps.map((p) => p.id === id ? { ...p, status: 'processing' as const } : p));
  }

  async function confirmPayout(id: string) {
    if (!extRef.trim()) { toast.error('External reference is required'); return; }
    try {
      const timestamp = nowIso();
      await adminApi.confirmPayout(id, {
        external_reference: extRef,
        external_timestamp: timestamp,
        external_note: extNote || undefined,
      });
      toast.success('Payout confirmed');
      setPayouts((ps) => ps.filter((p) => p.id !== id));
      setConfirming(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Confirm failed');
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Pending BDT Payouts</h2>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Reminder:</strong> Confirm a payout ONLY after the real BDT transfer has been made externally (bKash, Nagad, bank). Record the actual external transaction reference below.
      </div>

      {payouts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">No pending payouts.</div>
      ) : (
        payouts.map((p) => (
          <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-xl tabular-nums" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{formatBdt(p.amount_bdt_poisha)}</p>
                <p className="text-sm text-slate-500 capitalize">{p.payout_method.replace('_', ' ')} · {p.payout_account_name}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${p.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                {p.status}
              </span>
            </div>

            {confirming === p.id ? (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">External Transaction Reference *</label>
                  <input value={extRef} onChange={(e) => setExtRef(e.target.value)} placeholder="bKash TrxID or bank ref" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
                  <input value={extNote} onChange={(e) => setExtNote(e.target.value)} placeholder="Any additional notes" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { void confirmPayout(p.id); }} className="flex-1 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700">
                    Confirm Payout
                  </button>
                  <button onClick={() => setConfirming(null)} className="px-4 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 border-t border-slate-100 pt-4">
                {p.status === 'pending' && (
                  <button onClick={() => { void initiateTransfer(p.id); }} className="px-4 py-2 border border-slate-200 text-sm rounded-lg text-slate-700 hover:bg-slate-50">
                    Mark Processing
                  </button>
                )}
                <button onClick={() => { setConfirming(p.id); setExtRef(''); setExtNote(''); }} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 ml-auto">
                  <CheckCircle className="w-4 h-4" /> Confirm Transfer
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ---- Audit Logs ----
function AdminAuditLogs() {
  const [logs, setLogs] = useState<unknown[]>([]);

  useEffect(() => {
    void adminApi.getAuditLogs().then((r) => setLogs(r.logs));
  }, []);

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Audit Logs</h2>
      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="divide-y divide-slate-100">
          {(logs as Array<{id: string; action: string; actor_email: string; target_type: string; target_id: string; created_at: string}>).map((log) => (
            <div key={log.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div>
                <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{log.action}</span>
                <span className="ml-2 text-slate-500">{log.actor_email ?? 'system'}</span>
                {log.target_type && <span className="ml-2 text-slate-300 text-xs">{log.target_type}:{log.target_id?.slice(0, 8)}</span>}
              </div>
              <span className="text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="px-5 py-8 text-center text-slate-400">No audit logs.</p>
          )}
        </div>
      </div>
    </div>
  );
}

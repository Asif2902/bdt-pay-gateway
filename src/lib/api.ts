/**
 * Typed API client for all backend routes (Vercel API functions).
 * Auth token stored in localStorage under 'auth_token'.
 */

import type {
  Merchant, Invoice, Payment, LedgerEntry, Payout,
  CreateInvoiceRequest,
} from '@/types';

const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const json = await res.json() as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error ?? `API error ${res.status}`);
  return json.data as T;
}

// ---- Auth ----
export const authApi = {
  register: (email: string, password: string, fullName?: string) =>
    apiFetch<{ token: string; user: { id: string; email: string; role: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name: fullName }),
    }),
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: { id: string; email: string; role: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => apiFetch<{ user: { id: string; email: string; role: string } }>('/auth/me'),
};

// ---- Merchants ----
export const merchantApi = {
  get: () => apiFetch<Merchant | null>('/merchants'),
  create: (data: Partial<Merchant>) =>
    apiFetch<Merchant>('/merchants', { method: 'POST', body: JSON.stringify(data) }),
  update: (data: Partial<Merchant>) =>
    apiFetch<Merchant>('/merchants', { method: 'PUT', body: JSON.stringify(data) }),
};

// ---- Invoices ----
export const invoiceApi = {
  list: (params?: { page?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    if (params?.status) q.set('status', params.status);
    return apiFetch<{ invoices: Invoice[]; total: number }>(`/invoices?${q}`);
  },
  get: (id: string) => apiFetch<Invoice>(`/invoices/${id}`),
  create: (data: CreateInvoiceRequest) =>
    apiFetch<{ invoice: Invoice; checkout_url: string }>('/invoices', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  cancel: (id: string) =>
    apiFetch<{ ok: boolean }>(`/invoices/${id}`, { method: 'POST' }),
  getPublic: (id: string) =>
    apiFetch<{ invoice: Invoice; merchant: Partial<Merchant> }>(`/public/invoice/${id}`),
  authorize: (id: string) =>
    apiFetch<{
      invoiceId: string; merchantId: string; amountUsdc: string;
      expiry: string; nonce: string; signature: string;
    }>(`/public/invoice/${id}`, { method: 'POST' }),
};

// ---- Payments ----
export const paymentApi = {
  list: (params?: { page?: number }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetch<{ payments: Payment[]; total: number }>(`/payments?${q}`);
  },
  verify: (data: { invoice_id: string; tx_hash: string; payer_wallet_address: string }) =>
    apiFetch<{ payment_id: string; amount_bdt_poisha: number; new_balance: number }>('/payments/verify', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ---- Ledger ----
export const ledgerApi = {
  balance: () => apiFetch<{ balance: number }>('/ledger?balance_only=true'),
  list: (params?: { page?: number }) => {
    const q = new URLSearchParams({ balance_only: 'false' });
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetch<{ balance: number; entries: LedgerEntry[]; total: number }>(`/ledger?${q}`);
  },
};

// ---- Payouts ----
export const payoutApi = {
  list: () => apiFetch<{ payouts: Payout[] }>('/payouts'),
  request: (data: {
    amount_bdt_poisha: number;
    payout_method: string;
    payout_account_name: string;
    payout_account_number: string;
    payout_bank_name?: string;
  }) => apiFetch<{ payout: Payout }>('/payouts', { method: 'POST', body: JSON.stringify(data) }),
};

// ---- Admin API ----
export const adminApi = {
  login: (password: string) =>
    apiFetch<{ token: string }>('/admin/auth', { method: 'POST', body: JSON.stringify({ password }) }),
  me: () => apiFetch<{ role: string }>('/admin/auth'),
  logout: () => apiFetch<{ ok: boolean }>('/admin/auth', { method: 'DELETE' }),

  listMerchants: (params?: { search?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetchAdmin<{ merchants: unknown[]; total: number }>(`/admin/merchants?${q}`);
  },
  suspendMerchant: (id: string, reason: string) =>
    apiFetchAdmin<{ ok: boolean }>(`/admin/merchants/${id}?action=suspend`, { method: 'POST', body: JSON.stringify({ reason }) }),
  activateMerchant: (id: string) =>
    apiFetchAdmin<{ ok: boolean }>(`/admin/merchants/${id}?action=activate`, { method: 'POST' }),

  listPayments: (params?: { search?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetchAdmin<{ payments: unknown[]; total: number }>(`/admin/payments?${q}`);
  },

  listPendingPayouts: () => apiFetchAdmin<{ payouts: Payout[] }>('/admin/payouts'),
  initiateTransfer: (id: string) =>
    apiFetchAdmin<{ ok: boolean }>(`/admin/payouts/${id}?action=initiate`, { method: 'POST' }),
  confirmPayout: (id: string, data: { external_reference: string; external_timestamp: string; external_note?: string }) =>
    apiFetchAdmin<{ ok: boolean }>(`/admin/payouts/${id}?action=confirm`, { method: 'POST', body: JSON.stringify(data) }),
  cancelPayout: (id: string, reason: string) =>
    apiFetchAdmin<{ ok: boolean }>(`/admin/payouts/${id}?action=cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),

  getAuditLogs: (page?: number) => {
    const q = new URLSearchParams();
    if (page !== undefined) q.set('page', String(page));
    return apiFetchAdmin<{ logs: unknown[] }>(`/admin/audit?${q}`);
  },
};

function getAdminToken(): string | null {
  return sessionStorage.getItem('admin_token');
}

async function apiFetchAdmin<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const json = await res.json() as { success: boolean; data?: T; error?: string };
  if (!json.success) throw new Error(json.error ?? `API error ${res.status}`);
  return json.data as T;
}

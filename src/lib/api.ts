// ============================================================
// Frontend API client — calls the Express backend via Vite proxy
// All requests go to /api/* which Vite proxies to the Express server
// ============================================================
import type {
  ApiResponse,
  CreateMerchantRequest,
  UpdateMerchantRequest,
  UpdatePayoutDetailsRequest,
  CreateInvoiceRequest,
  CreateInvoiceResponse,
  VerifyPaymentRequest,
  CreatePayoutRequest,
  ConfirmPayoutRequest,
  Invoice,
  Payment,
  MerchantLedgerEntry,
  Payout,
  Merchant,
  PublicMerchant,
  Profile,
  InvoiceAuthorization,
} from '@/types';
import { supabase } from './supabase';

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success || !res.ok) {
    throw new Error(json.error ?? `Request failed: ${res.status}`);
  }
  return json.data as T;
}

// ============================================================
// MERCHANT
// ============================================================

export const merchantApi = {
  create: (body: CreateMerchantRequest) =>
    apiFetch<Merchant>('/merchants', { method: 'POST', body: JSON.stringify(body) }),

  getOwn: () => apiFetch<Merchant>('/merchants/me'),

  update: (body: UpdateMerchantRequest) =>
    apiFetch<Merchant>('/merchants/me', { method: 'PATCH', body: JSON.stringify(body) }),

  updatePayoutDetails: (body: UpdatePayoutDetailsRequest) =>
    apiFetch<{ ok: boolean }>('/merchants/me/payout-details', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  getBySlug: (slug: string) => apiFetch<PublicMerchant>(`/public/merchants/${slug}`),
};

// ============================================================
// INVOICES
// ============================================================

export const invoiceApi = {
  create: (body: CreateInvoiceRequest) =>
    apiFetch<CreateInvoiceResponse>('/invoices', { method: 'POST', body: JSON.stringify(body) }),

  list: (params?: { status?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetch<{ invoices: Invoice[]; total: number }>(`/invoices?${q}`);
  },

  get: (id: string) => apiFetch<Invoice>(`/invoices/${id}`),

  cancel: (id: string) =>
    apiFetch<{ ok: boolean }>(`/invoices/${id}/cancel`, { method: 'POST' }),

  // Public endpoint — no auth required
  getPublic: (id: string) => apiFetch<{ invoice: Invoice; merchant: PublicMerchant }>(`/public/invoices/${id}`),

  // Get authorization for on-chain payment (signs with operator key)
  getAuthorization: (id: string) => apiFetch<InvoiceAuthorization>(`/public/invoices/${id}/authorize`),
};

// ============================================================
// PAYMENTS
// ============================================================

export const paymentApi = {
  verify: (body: VerifyPaymentRequest) =>
    apiFetch<Payment>('/payments/verify', { method: 'POST', body: JSON.stringify(body) }),

  list: (params?: { page?: number }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetch<{ payments: Payment[]; total: number }>(`/payments?${q}`);
  },

  get: (id: string) => apiFetch<Payment>(`/payments/${id}`),
};

// ============================================================
// LEDGER
// ============================================================

export const ledgerApi = {
  getBalance: () => apiFetch<{ balance_poisha: number }>('/ledger/balance'),

  list: (params?: { page?: number }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetch<{ entries: MerchantLedgerEntry[]; total: number }>(`/ledger?${q}`);
  },
};

// ============================================================
// PAYOUTS
// ============================================================

export const payoutApi = {
  request: (body: CreatePayoutRequest) =>
    apiFetch<Payout>('/payouts', { method: 'POST', body: JSON.stringify(body) }),

  list: (params?: { status?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetch<{ payouts: Payout[]; total: number }>(`/payouts?${q}`);
  },

  get: (id: string) => apiFetch<Payout>(`/payouts/${id}`),
};

// ============================================================
// ADMIN
// ============================================================

export const adminApi = {
  listMerchants: (params?: { page?: number; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    if (params?.search) q.set('search', params.search);
    return apiFetch<{ merchants: (Merchant & { profile: Profile })[]; total: number }>(
      `/admin/merchants?${q}`,
    );
  },

  suspendMerchant: (id: string, reason: string) =>
    apiFetch<{ ok: boolean }>(`/admin/merchants/${id}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  activateMerchant: (id: string) =>
    apiFetch<{ ok: boolean }>(`/admin/merchants/${id}/activate`, { method: 'POST' }),

  listPayments: (params?: { page?: number; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    if (params?.search) q.set('search', params.search);
    return apiFetch<{ payments: Payment[]; total: number }>(`/admin/payments?${q}`);
  },

  listPendingPayouts: (params?: { page?: number }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    return apiFetch<{ payouts: Payout[]; total: number }>(`/admin/payouts/pending?${q}`);
  },

  initiateTransfer: (payoutId: string) =>
    apiFetch<{ ok: boolean }>(`/admin/payouts/${payoutId}/initiate`, { method: 'POST' }),

  confirmPayout: (payoutId: string, body: ConfirmPayoutRequest) =>
    apiFetch<{ ok: boolean }>(`/admin/payouts/${payoutId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelPayout: (payoutId: string, reason: string) =>
    apiFetch<{ ok: boolean }>(`/admin/payouts/${payoutId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  getAuditLogs: (params?: { page?: number; action?: string }) => {
    const q = new URLSearchParams();
    if (params?.page !== undefined) q.set('page', String(params.page));
    if (params?.action) q.set('action', params.action);
    return apiFetch<{ logs: unknown[]; total: number }>(`/admin/audit-logs?${q}`);
  },
};

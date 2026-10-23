// ============================================================
// Shared TypeScript types for the USDC-to-BDT Payment Gateway
// ============================================================

export type UserRole = 'merchant' | 'admin' | 'operator';
export type InvoiceStatus = 'pending' | 'paid' | 'expired' | 'cancelled';
export type PaymentStatus = 'pending' | 'confirmed' | 'failed';
export type PayoutStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type PayoutMethod = 'bkash' | 'nagad' | 'bank_transfer' | 'other';
export type LedgerEntryType = 'credit' | 'debit' | 'adjustment';

// ============================================================
// DATABASE ROW TYPES
// ============================================================

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Merchant {
  id: string;
  profile_id: string;
  shop_name: string;
  slug: string;
  business_description: string | null;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website_url: string | null;
  payout_method: PayoutMethod | null;
  payout_account_name: string | null;
  payout_account_number: string | null;
  payout_bank_name: string | null;
  payout_bank_branch: string | null;
  payout_routing_number: string | null;
  custom_rate_poisha_per_usdc: number | null;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Public merchant info (no payout details)
export interface PublicMerchant {
  id: string;
  shop_name: string;
  slug: string;
  business_description: string | null;
  logo_url: string | null;
  contact_email: string | null;
  website_url: string | null;
  is_active: boolean;
}

export interface Invoice {
  id: string;
  merchant_id: string;
  amount_bdt_poisha: number;
  rate_poisha_per_usdc: number;
  amount_usdc_units: number;
  customer_reference: string | null;
  description: string | null;
  customer_wallet_address: string | null;
  status: InvoiceStatus;
  expires_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  merchant_id: string;
  tx_hash: string;
  block_number: number;
  block_timestamp: string;
  chain_id: number;
  contract_address: string;
  usdc_token_address: string;
  payer_wallet_address: string;
  amount_usdc_units: number;
  amount_bdt_poisha: number;
  rate_poisha_per_usdc: number;
  confirmations_at_verify: number;
  status: PaymentStatus;
  verified_at: string | null;
  verified_by: string | null;
  ledger_credited: boolean;
  ledger_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantLedgerEntry {
  id: string;
  merchant_id: string;
  entry_type: LedgerEntryType;
  amount_poisha: number;
  balance_after: number;
  payment_id: string | null;
  payout_id: string | null;
  description: string;
  created_at: string;
  created_by: string;
}

export interface Payout {
  id: string;
  merchant_id: string;
  amount_bdt_poisha: number;
  payout_method: PayoutMethod;
  payout_account_name: string;
  payout_account_number: string;
  payout_bank_name: string | null;
  status: PayoutStatus;
  initiated_by: string | null;
  initiated_at: string | null;
  external_reference: string | null;
  external_timestamp: string | null;
  external_note: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  failed_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  ledger_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// API REQUEST / RESPONSE TYPES
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface CreateMerchantRequest {
  shop_name: string;
  slug: string;
  business_description?: string;
  contact_email?: string;
  contact_phone?: string;
  website_url?: string;
}

export interface UpdateMerchantRequest {
  shop_name?: string;
  business_description?: string;
  contact_email?: string;
  contact_phone?: string;
  website_url?: string;
  logo_url?: string;
}

export interface UpdatePayoutDetailsRequest {
  payout_method: PayoutMethod;
  payout_account_name: string;
  payout_account_number: string;
  payout_bank_name?: string;
  payout_bank_branch?: string;
  payout_routing_number?: string;
}

export interface CreateInvoiceRequest {
  amount_bdt_poisha: number;
  customer_reference?: string;
  description?: string;
}

export interface CreateInvoiceResponse {
  invoice: Invoice;
  checkout_url: string;
}

// Authorization signed by backend for on-chain payment
export interface InvoiceAuthorization {
  invoiceId: `0x${string}`;   // bytes32 hex
  merchantId: `0x${string}`;  // bytes32 hex
  amountUsdc: bigint;
  expiry: bigint;
  nonce: `0x${string}`;       // bytes32 hex
  signature: `0x${string}`;   // 65-byte EIP-712 signature
}

export interface VerifyPaymentRequest {
  tx_hash: string;
  invoice_id: string;
}

export interface CreatePayoutRequest {
  amount_bdt_poisha: number;
}

export interface ConfirmPayoutRequest {
  external_reference: string;
  external_timestamp: string;  // ISO8601
  external_note?: string;
}

// ============================================================
// FRONTEND STATE TYPES
// ============================================================

export interface AuthState {
  user: import('@supabase/supabase-js').User | null;
  profile: Profile | null;
  merchant: Merchant | null;
  loading: boolean;
}

export interface CheckoutState {
  merchant: PublicMerchant | null;
  invoice: Invoice | null;
  ratePoishaPer1Usdc: number;
  loading: boolean;
  error: string | null;
}

// BDT/USDC display helpers
export const POISHA_PER_BDT = 100;
export const USDC_UNITS_PER_USDC = 1_000_000;

export function formatBdt(poisha: number): string {
  const bdt = Math.floor(poisha / POISHA_PER_BDT);
  const remainderPoisha = poisha % POISHA_PER_BDT;
  if (remainderPoisha === 0) return `৳${bdt.toLocaleString('en-BD')}`;
  return `৳${bdt.toLocaleString('en-BD')}.${String(remainderPoisha).padStart(2, '0')}`;
}

export function formatUsdc(units: number): string {
  const whole = Math.floor(units / USDC_UNITS_PER_USDC);
  const fractional = units % USDC_UNITS_PER_USDC;
  const fracStr = String(fractional).padStart(6, '0').replace(/0+$/, '');
  if (!fracStr) return `${whole.toLocaleString()} USDC`;
  return `${whole.toLocaleString()}.${fracStr} USDC`;
}

/** Integer division: ceiling. a, b are safe integers. */
export function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/** Calculate USDC units needed for a BDT amount at the given rate. */
export function calcUsdcUnits(bdtPoisha: number, ratePoishaPer1Usdc: number): number {
  // ceil(bdtPoisha * 1_000_000 / ratePoishaPer1Usdc)
  // Uses BigInt to avoid floating point for large values
  const n = BigInt(bdtPoisha) * BigInt(USDC_UNITS_PER_USDC);
  const d = BigInt(ratePoishaPer1Usdc);
  return Number((n + d - 1n) / d);
}

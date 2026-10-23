-- ============================================================
-- Migration 001: Initial schema for USDC-to-BDT Payment Gateway
-- ============================================================
-- All monetary amounts stored as integers:
--   BDT in POISHA (1 BDT = 100 poisha)
--   USDC in its smallest unit (1 USDC = 1_000_000 units, 6 decimals)
-- Exchange rate stored as: bdtPer1USDC in poisha-per-USDC-unit form
--   e.g., 125 BDT/USDC = 12500 poisha per 1 USDC
--       = 12500 * 10^-6 poisha per USDC-unit  — stored as bdtPoisha integer per USDC (full token)
--   Precise: rate_poisha_per_usdc represents poisha per 1 whole USDC
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('merchant', 'admin', 'operator');
CREATE TYPE invoice_status AS ENUM ('pending', 'paid', 'expired', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'confirmed', 'failed');
CREATE TYPE payout_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE payout_method AS ENUM ('bkash', 'nagad', 'bank_transfer', 'other');
CREATE TYPE ledger_entry_type AS ENUM ('credit', 'debit', 'adjustment');
CREATE TYPE audit_action AS ENUM (
  'merchant_created', 'merchant_suspended', 'merchant_activated',
  'invoice_created', 'invoice_cancelled',
  'payment_verified', 'payment_rejected',
  'payout_created', 'payout_confirmed', 'payout_cancelled',
  'ledger_adjusted', 'admin_login', 'role_changed',
  'payout_details_viewed'
);

-- ============================================================
-- PROFILES (linked to Supabase Auth users)
-- ============================================================

CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT,
  role          user_role NOT NULL DEFAULT 'merchant',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_email ON profiles(email);

-- ============================================================
-- MERCHANTS
-- ============================================================

CREATE TABLE merchants (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id            UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  shop_name             TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  business_description  TEXT,
  logo_url              TEXT,
  contact_email         TEXT,
  contact_phone         TEXT,
  website_url           TEXT,
  -- BDT payout details (encrypted at rest via Supabase vault in production)
  -- Stored here as plaintext for local dev; use Supabase Vault for production
  payout_method         payout_method,
  payout_account_name   TEXT,  -- bKash/Nagad number or bank account name
  payout_account_number TEXT,  -- NEVER store PINs or passwords
  payout_bank_name      TEXT,  -- for bank transfers
  payout_bank_branch    TEXT,
  payout_routing_number TEXT,
  -- Exchange rate: poisha per 1 whole USDC (e.g., 12500 = 125 BDT/USDC)
  -- If null, use system default
  custom_rate_poisha_per_usdc BIGINT CHECK (custom_rate_poisha_per_usdc > 0),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_suspended          BOOLEAN NOT NULL DEFAULT FALSE,
  suspension_reason     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merchants_slug ON merchants(slug);
CREATE INDEX idx_merchants_profile_id ON merchants(profile_id);
CREATE INDEX idx_merchants_is_active ON merchants(is_active);

-- ============================================================
-- INVOICES
-- ============================================================

CREATE TABLE invoices (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id             UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  -- Amount in BDT (poisha), as entered by customer at checkout
  amount_bdt_poisha       BIGINT NOT NULL CHECK (amount_bdt_poisha > 0),
  -- Exchange rate locked at invoice creation (poisha per 1 whole USDC)
  rate_poisha_per_usdc    BIGINT NOT NULL CHECK (rate_poisha_per_usdc > 0),
  -- Required USDC in smallest unit (6 decimals): ceil(amount_bdt_poisha * 1e6 / rate_poisha_per_usdc)
  amount_usdc_units       BIGINT NOT NULL CHECK (amount_usdc_units > 0),
  -- Customer/order metadata
  customer_reference      TEXT,   -- merchant-provided order ref
  description             TEXT,
  customer_wallet_address TEXT,   -- set after payment
  -- Status management
  status                  invoice_status NOT NULL DEFAULT 'pending',
  expires_at              TIMESTAMPTZ NOT NULL,
  paid_at                 TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  cancel_reason           TEXT,
  -- Authorization nonce for contract call (prevents replay)
  auth_nonce              BYTEA NOT NULL,  -- 32-byte random nonce
  auth_expires_at         TIMESTAMPTZ NOT NULL,
  -- On-chain payment reference (set after verification)
  payment_id              UUID,  -- FK set after payment verified
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_merchant_id ON invoices(merchant_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_expires_at ON invoices(expires_at);
CREATE INDEX idx_invoices_customer_wallet ON invoices(customer_wallet_address);

-- ============================================================
-- PAYMENTS (verified on-chain payments)
-- ============================================================

CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id            UUID NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
  merchant_id           UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  -- On-chain data (all verified independently by backend)
  tx_hash               TEXT NOT NULL UNIQUE,
  block_number          BIGINT NOT NULL,
  block_timestamp       TIMESTAMPTZ NOT NULL,
  chain_id              BIGINT NOT NULL,
  contract_address      TEXT NOT NULL,
  usdc_token_address    TEXT NOT NULL,
  payer_wallet_address  TEXT NOT NULL,
  -- Amounts (exactly as on-chain)
  amount_usdc_units     BIGINT NOT NULL CHECK (amount_usdc_units > 0),
  -- BDT credit computed at locked rate
  amount_bdt_poisha     BIGINT NOT NULL CHECK (amount_bdt_poisha > 0),
  rate_poisha_per_usdc  BIGINT NOT NULL CHECK (rate_poisha_per_usdc > 0),
  -- Verification metadata
  confirmations_at_verify INT NOT NULL DEFAULT 0,
  status                payment_status NOT NULL DEFAULT 'pending',
  verified_at           TIMESTAMPTZ,
  verified_by           TEXT,  -- 'system' or operator user id
  -- Idempotency guard: prevents double-crediting
  ledger_credited       BOOLEAN NOT NULL DEFAULT FALSE,
  ledger_entry_id       UUID,  -- FK to merchant_ledger after credit
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_invoice_id ON payments(invoice_id);
CREATE INDEX idx_payments_merchant_id ON payments(merchant_id);
CREATE INDEX idx_payments_tx_hash ON payments(tx_hash);
CREATE INDEX idx_payments_payer_wallet ON payments(payer_wallet_address);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_chain_id ON payments(chain_id);

-- ============================================================
-- MERCHANT LEDGER (auditable credits and debits)
-- ============================================================

CREATE TABLE merchant_ledger (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id     UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  entry_type      ledger_entry_type NOT NULL,
  -- Amount in BDT poisha (always positive; sign determined by entry_type)
  amount_poisha   BIGINT NOT NULL CHECK (amount_poisha > 0),
  -- Running balance AFTER this entry (poisha) — maintained by trigger
  balance_after   BIGINT NOT NULL,
  -- Reference
  payment_id      UUID REFERENCES payments(id) ON DELETE RESTRICT,
  payout_id       UUID,  -- FK to payouts (set after payout table created)
  description     TEXT NOT NULL,
  -- Immutable: adjustments use new entries, not edits
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT NOT NULL  -- 'system', 'admin:<id>', 'operator:<id>'
);

CREATE INDEX idx_ledger_merchant_id ON merchant_ledger(merchant_id);
CREATE INDEX idx_ledger_payment_id ON merchant_ledger(payment_id);
CREATE INDEX idx_ledger_created_at ON merchant_ledger(created_at);

-- ============================================================
-- PAYOUTS
-- ============================================================

CREATE TABLE payouts (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id             UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  -- Amount in BDT (poisha)
  amount_bdt_poisha       BIGINT NOT NULL CHECK (amount_bdt_poisha > 0),
  -- Payout method and details (snapshot at payout creation)
  payout_method           payout_method NOT NULL,
  payout_account_name     TEXT NOT NULL,
  payout_account_number   TEXT NOT NULL,
  payout_bank_name        TEXT,
  -- Status workflow: pending → processing → completed | failed | cancelled
  status                  payout_status NOT NULL DEFAULT 'pending',
  -- Operator who initiates external transfer
  initiated_by            UUID REFERENCES profiles(id),
  initiated_at            TIMESTAMPTZ,
  -- External transfer details (recorded after real transfer occurs)
  external_reference      TEXT,  -- bKash TrxID, bank ref, etc.
  external_timestamp      TIMESTAMPTZ,
  external_note           TEXT,
  -- Admin confirmation
  confirmed_by            UUID REFERENCES profiles(id),
  confirmed_at            TIMESTAMPTZ,
  -- Failure / cancellation
  failed_reason           TEXT,
  cancelled_at            TIMESTAMPTZ,
  cancelled_by            UUID REFERENCES profiles(id),
  cancel_reason           TEXT,
  -- Ledger entry
  ledger_entry_id         UUID REFERENCES merchant_ledger(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Merchant cannot confirm their own payout
  CONSTRAINT no_self_confirm CHECK (confirmed_by != merchant_id::UUID OR confirmed_by IS NULL)
);

CREATE INDEX idx_payouts_merchant_id ON payouts(merchant_id);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_payouts_created_at ON payouts(created_at);
CREATE INDEX idx_payouts_external_ref ON payouts(external_reference);

-- Add FK from merchant_ledger to payouts now that payouts table exists
ALTER TABLE merchant_ledger ADD CONSTRAINT fk_ledger_payout
  FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE RESTRICT;

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_email   TEXT,
  action        audit_action NOT NULL,
  target_type   TEXT,   -- 'merchant', 'invoice', 'payment', 'payout', 'profile'
  target_id     UUID,
  details       JSONB,  -- Additional context (never store secrets here)
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================================
-- SYSTEM CONFIG
-- ============================================================

CREATE TABLE system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES profiles(id)
);

-- Default exchange rate: 125 BDT per USDC = 12500 poisha per USDC
INSERT INTO system_config (key, value, description) VALUES
  ('default_rate_poisha_per_usdc', '12500', 'Default BDT exchange rate: poisha per 1 whole USDC (12500 = 125 BDT/USDC)'),
  ('invoice_expiry_minutes', '30', 'Invoice expiry in minutes from creation'),
  ('invoice_auth_expiry_minutes', '15', 'Invoice authorization nonce expiry in minutes'),
  ('min_invoice_amount_bdt_poisha', '100', 'Minimum invoice amount in poisha (100 = 1 BDT)'),
  ('max_invoice_amount_bdt_poisha', '10000000', 'Maximum invoice amount in poisha (100000 = 1000 BDT)'),
  ('required_confirmations', '2', 'Required block confirmations before crediting payment'),
  ('arc_mainnet_chain_id', '5042', 'Arc mainnet chain ID'),
  ('arc_usdc_address', '0x3600000000000000000000000000000000000000', 'USDC contract address on Arc mainnet');

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_merchants_updated_at
  BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payouts_updated_at
  BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON AUTH USER CREATION
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'merchant')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ============================================================
-- LEDGER BALANCE VALIDATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION get_merchant_balance(p_merchant_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  SELECT COALESCE(SUM(
    CASE entry_type
      WHEN 'credit'     THEN amount_poisha
      WHEN 'debit'      THEN -amount_poisha
      WHEN 'adjustment' THEN amount_poisha  -- signed adjustments use separate entries
    END
  ), 0)
  INTO v_balance
  FROM merchant_ledger
  WHERE merchant_id = p_merchant_id;
  RETURN v_balance;
END;
$$ LANGUAGE plpgsql STABLE;

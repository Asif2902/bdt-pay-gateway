-- ============================================================
-- Migration 003: Additional indexes, constraints, and views
-- ============================================================

-- Composite indexes for common query patterns
CREATE INDEX idx_invoices_merchant_status ON invoices(merchant_id, status);
CREATE INDEX idx_invoices_merchant_created ON invoices(merchant_id, created_at DESC);
CREATE INDEX idx_payments_merchant_verified ON payments(merchant_id, verified_at DESC);
CREATE INDEX idx_ledger_merchant_created ON merchant_ledger(merchant_id, created_at DESC);
CREATE INDEX idx_payouts_merchant_status ON payouts(merchant_id, status);

-- GIN index for JSONB audit log details search
CREATE INDEX idx_audit_logs_details ON audit_logs USING GIN(details);

-- Partial index: pending invoices that haven't expired
CREATE INDEX idx_invoices_active_pending
  ON invoices(merchant_id, created_at)
  WHERE status = 'pending' AND expires_at > NOW();

-- Prevent duplicate payment for same tx_hash (belt + suspenders; UNIQUE already set)
-- Partial index to enforce one confirmed payment per invoice
CREATE UNIQUE INDEX idx_payments_invoice_confirmed
  ON payments(invoice_id)
  WHERE status = 'confirmed';

-- ============================================================
-- MERCHANT BALANCE VIEW (for dashboards)
-- ============================================================

CREATE OR REPLACE VIEW merchant_balance_view AS
SELECT
  m.id AS merchant_id,
  m.shop_name,
  m.slug,
  COALESCE(SUM(
    CASE ml.entry_type
      WHEN 'credit'     THEN ml.amount_poisha
      WHEN 'debit'      THEN -ml.amount_poisha
      WHEN 'adjustment' THEN ml.amount_poisha
    END
  ), 0) AS balance_poisha,
  COUNT(CASE WHEN ml.entry_type = 'credit' THEN 1 END) AS total_credits,
  SUM(CASE WHEN ml.entry_type = 'credit' THEN ml.amount_poisha ELSE 0 END) AS total_credited_poisha,
  SUM(CASE WHEN ml.entry_type = 'debit' THEN ml.amount_poisha ELSE 0 END) AS total_debited_poisha
FROM merchants m
LEFT JOIN merchant_ledger ml ON ml.merchant_id = m.id
GROUP BY m.id, m.shop_name, m.slug;

-- RLS on view is not directly supported — access via backend API with service role

-- ============================================================
-- PAYMENT SUMMARY VIEW
-- ============================================================

CREATE OR REPLACE VIEW payment_summary_view AS
SELECT
  p.id,
  p.tx_hash,
  p.merchant_id,
  m.shop_name,
  m.slug,
  i.id AS invoice_id,
  i.customer_reference,
  i.description AS invoice_description,
  p.payer_wallet_address,
  p.amount_usdc_units,
  p.amount_bdt_poisha,
  p.rate_poisha_per_usdc,
  p.status,
  p.verified_at,
  p.block_number,
  p.chain_id,
  p.created_at
FROM payments p
JOIN merchants m ON m.id = p.merchant_id
JOIN invoices i ON i.id = p.invoice_id;

-- ============================================================
-- PAYOUT SUMMARY VIEW (omits sensitive account numbers for non-admin)
-- ============================================================

CREATE OR REPLACE VIEW payout_summary_view AS
SELECT
  po.id,
  po.merchant_id,
  m.shop_name,
  po.amount_bdt_poisha,
  po.payout_method,
  -- Masked account: show only last 4 digits
  CASE
    WHEN LENGTH(po.payout_account_number) > 4
    THEN REPEAT('*', LENGTH(po.payout_account_number) - 4) ||
         RIGHT(po.payout_account_number, 4)
    ELSE po.payout_account_number
  END AS payout_account_masked,
  po.payout_account_name,
  po.status,
  po.initiated_at,
  po.external_reference,
  po.external_timestamp,
  po.confirmed_at,
  po.created_at
FROM payouts po
JOIN merchants m ON m.id = po.merchant_id;

-- ============================================================
-- ADMIN-ONLY VIEW: pending payouts with full details
-- ============================================================

CREATE OR REPLACE VIEW admin_pending_payouts_view AS
SELECT
  po.id,
  po.merchant_id,
  m.shop_name,
  m.slug,
  prof.email AS merchant_email,
  po.amount_bdt_poisha,
  po.payout_method,
  po.payout_account_name,
  po.payout_account_number,  -- Full account for operator
  po.payout_bank_name,
  po.status,
  po.initiated_by,
  po.initiated_at,
  po.external_reference,
  po.external_note,
  po.created_at,
  get_merchant_balance(m.id) AS current_balance_poisha
FROM payouts po
JOIN merchants m ON m.id = po.merchant_id
JOIN profiles prof ON prof.id = m.profile_id
WHERE po.status IN ('pending', 'processing');

-- ============================================================
-- FUNCTION: safe invoice amount calculation (integer arithmetic only)
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_usdc_units(
  p_bdt_poisha BIGINT,
  p_rate_poisha_per_usdc BIGINT
)
RETURNS BIGINT AS $$
-- Calculates USDC units (6 decimals) needed for a given BDT amount
-- Formula: ceil(bdt_poisha * 1_000_000 / rate_poisha_per_usdc)
-- This is exact integer arithmetic — no floating point.
DECLARE
  v_usdc_units BIGINT;
BEGIN
  IF p_rate_poisha_per_usdc <= 0 THEN
    RAISE EXCEPTION 'Rate must be positive';
  END IF;
  -- Ceiling division: (a + b - 1) / b
  v_usdc_units := (p_bdt_poisha * 1000000 + p_rate_poisha_per_usdc - 1) / p_rate_poisha_per_usdc;
  IF v_usdc_units <= 0 THEN
    RAISE EXCEPTION 'Calculated USDC units must be positive';
  END IF;
  RETURN v_usdc_units;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- FUNCTION: credit merchant ledger (atomic, idempotent via payment_id)
-- ============================================================

CREATE OR REPLACE FUNCTION credit_merchant_for_payment(
  p_payment_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_current_balance BIGINT;
  v_new_balance BIGINT;
  v_ledger_id UUID;
BEGIN
  -- Lock the payment row to prevent concurrent double-credits
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  IF v_payment.status != 'confirmed' THEN
    RAISE EXCEPTION 'Payment % is not confirmed (status: %)', p_payment_id, v_payment.status;
  END IF;

  IF v_payment.ledger_credited THEN
    -- Idempotent: already credited, return existing ledger entry
    RETURN v_payment.ledger_entry_id;
  END IF;

  -- Calculate current balance
  v_current_balance := get_merchant_balance(v_payment.merchant_id);
  v_new_balance := v_current_balance + v_payment.amount_bdt_poisha;

  -- Insert ledger entry
  INSERT INTO merchant_ledger (
    merchant_id, entry_type, amount_poisha, balance_after,
    payment_id, description, created_by
  ) VALUES (
    v_payment.merchant_id,
    'credit',
    v_payment.amount_bdt_poisha,
    v_new_balance,
    p_payment_id,
    'USDC payment verified: tx ' || LEFT(v_payment.tx_hash, 10) || '...',
    'system'
  ) RETURNING id INTO v_ledger_id;

  -- Mark payment as credited (idempotency guard)
  UPDATE payments
  SET ledger_credited = TRUE, ledger_entry_id = v_ledger_id
  WHERE id = p_payment_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

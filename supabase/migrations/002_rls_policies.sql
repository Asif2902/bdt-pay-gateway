-- ============================================================
-- Migration 002: Row Level Security (RLS) Policies
-- ============================================================
-- All sensitive tables have RLS enforced.
-- Service role (backend API) bypasses RLS by design (Supabase default).
-- Frontend should NEVER use the service role key.
-- ============================================================

-- ============================================================
-- HELPER: get calling user's role
-- ============================================================

CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth_is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin', 'operator') AND is_active = TRUE
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth_is_merchant_owner(p_merchant_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM merchants m
    JOIN profiles p ON p.id = m.profile_id
    WHERE m.id = p_merchant_id AND p.id = auth.uid() AND p.is_active = TRUE
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- RLS: PROFILES
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (id = auth.uid());

-- Admins/operators can read all profiles
CREATE POLICY "profiles_select_admin"
  ON profiles FOR SELECT
  USING (auth_is_admin());

-- Users can update their own non-sensitive fields
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));
  -- Cannot self-escalate role

-- ============================================================
-- RLS: MERCHANTS
-- ============================================================

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;

-- Merchants can read their own merchant record
CREATE POLICY "merchants_select_own"
  ON merchants FOR SELECT
  USING (auth_is_merchant_owner(id));

-- Admins can read all merchants
CREATE POLICY "merchants_select_admin"
  ON merchants FOR SELECT
  USING (auth_is_admin());

-- Public can read active, non-suspended merchant (for checkout page)
-- Only exposes non-sensitive fields — RLS enforced at SELECT but payout fields
-- are filtered by the backend API, not at DB level, for checkout calls
CREATE POLICY "merchants_select_public_active"
  ON merchants FOR SELECT
  USING (is_active = TRUE AND is_suspended = FALSE);

-- Merchants can insert their own record (one per profile)
CREATE POLICY "merchants_insert_own"
  ON merchants FOR INSERT
  WITH CHECK (profile_id = auth.uid());

-- Merchants can update their own non-suspension fields
CREATE POLICY "merchants_update_own"
  ON merchants FOR UPDATE
  USING (auth_is_merchant_owner(id))
  WITH CHECK (
    profile_id = auth.uid()
    AND is_suspended = (SELECT is_suspended FROM merchants WHERE id = merchants.id)
    -- Cannot self-unsuspend
  );

-- Only admins can suspend/unsuspend
CREATE POLICY "merchants_update_admin"
  ON merchants FOR UPDATE
  USING (auth_is_admin());

-- ============================================================
-- RLS: INVOICES
-- ============================================================

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Merchants can see their own invoices
CREATE POLICY "invoices_select_own"
  ON invoices FOR SELECT
  USING (auth_is_merchant_owner(merchant_id));

-- Admins can see all invoices
CREATE POLICY "invoices_select_admin"
  ON invoices FOR SELECT
  USING (auth_is_admin());

-- Public can read a specific invoice (for checkout) — backend validates
-- The backend uses service role for verification; this allows anon checkout reads
CREATE POLICY "invoices_select_public"
  ON invoices FOR SELECT
  TO anon
  USING (
    status IN ('pending', 'paid')
    AND expires_at > NOW()
  );

-- Only merchants can create invoices for their shop
CREATE POLICY "invoices_insert_own"
  ON invoices FOR INSERT
  WITH CHECK (auth_is_merchant_owner(merchant_id));

-- Merchants can cancel their own pending invoices
CREATE POLICY "invoices_update_own_cancel"
  ON invoices FOR UPDATE
  USING (
    auth_is_merchant_owner(merchant_id)
    AND status = 'pending'
  );

-- Admins can update any invoice
CREATE POLICY "invoices_update_admin"
  ON invoices FOR UPDATE
  USING (auth_is_admin());

-- ============================================================
-- RLS: PAYMENTS
-- ============================================================

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Merchants can see their own payments
CREATE POLICY "payments_select_own"
  ON payments FOR SELECT
  USING (auth_is_merchant_owner(merchant_id));

-- Admins can see all payments
CREATE POLICY "payments_select_admin"
  ON payments FOR SELECT
  USING (auth_is_admin());

-- No direct inserts from frontend — only via service role (backend)
-- No direct updates from frontend — only via service role (backend)

-- ============================================================
-- RLS: MERCHANT LEDGER
-- ============================================================

ALTER TABLE merchant_ledger ENABLE ROW LEVEL SECURITY;

-- Merchants can see their own ledger
CREATE POLICY "ledger_select_own"
  ON merchant_ledger FOR SELECT
  USING (auth_is_merchant_owner(merchant_id));

-- Admins can see all ledger entries
CREATE POLICY "ledger_select_admin"
  ON merchant_ledger FOR SELECT
  USING (auth_is_admin());

-- No inserts/updates from frontend — all via service role (backend)

-- ============================================================
-- RLS: PAYOUTS
-- ============================================================

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Merchants can see their own payouts (but NOT payout account details — filtered by API)
CREATE POLICY "payouts_select_own"
  ON payouts FOR SELECT
  USING (auth_is_merchant_owner(merchant_id));

-- Admins can see all payouts
CREATE POLICY "payouts_select_admin"
  ON payouts FOR SELECT
  USING (auth_is_admin());

-- Merchants can request payouts (insert)
CREATE POLICY "payouts_insert_own"
  ON payouts FOR INSERT
  WITH CHECK (auth_is_merchant_owner(merchant_id));

-- Only operators/admins can update payout status
CREATE POLICY "payouts_update_admin"
  ON payouts FOR UPDATE
  USING (auth_is_admin());

-- ============================================================
-- RLS: AUDIT LOGS
-- ============================================================

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit logs
CREATE POLICY "audit_logs_select_admin"
  ON audit_logs FOR SELECT
  USING (auth_is_admin());

-- No frontend inserts — all via service role (backend)

-- ============================================================
-- RLS: SYSTEM CONFIG
-- ============================================================

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Admins can read all config
CREATE POLICY "system_config_select_admin"
  ON system_config FOR SELECT
  USING (auth_is_admin());

-- Merchants can read non-sensitive config (rates, limits)
CREATE POLICY "system_config_select_merchant"
  ON system_config FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND key IN (
      'default_rate_poisha_per_usdc',
      'invoice_expiry_minutes',
      'min_invoice_amount_bdt_poisha',
      'max_invoice_amount_bdt_poisha'
    )
  );

-- Public can read the exchange rate for checkout
CREATE POLICY "system_config_select_public_rate"
  ON system_config FOR SELECT
  TO anon
  USING (key = 'default_rate_poisha_per_usdc');

-- Only admins can update config
CREATE POLICY "system_config_update_admin"
  ON system_config FOR UPDATE
  USING (auth_is_admin());

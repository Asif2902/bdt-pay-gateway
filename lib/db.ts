/**
 * Turso (libSQL) client and schema bootstrap.
 *
 * All monetary amounts stored as integers:
 *   BDT in POISHA (1 BDT = 100 poisha)
 *   USDC in smallest unit (1 USDC = 1_000_000 units)
 *
 * Call initDb() once at cold-start (each Vercel function import).
 * The CREATE TABLE IF NOT EXISTS pattern is idempotent.
 */

import { createClient, type Client } from '@libsql/client';

let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set');
  _client = createClient({ url, authToken });
  return _client;
}

export async function initDb(): Promise<void> {
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      full_name   TEXT,
      password_hash TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'merchant',
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS merchants (
      id                          TEXT PRIMARY KEY,
      user_id                     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      shop_name                   TEXT NOT NULL,
      slug                        TEXT NOT NULL UNIQUE,
      business_description        TEXT,
      contact_email               TEXT,
      contact_phone               TEXT,
      website_url                 TEXT,
      payout_method               TEXT,
      payout_account_name         TEXT,
      payout_account_number       TEXT,
      payout_bank_name            TEXT,
      payout_bank_branch          TEXT,
      payout_routing_number       TEXT,
      custom_rate_poisha_per_usdc INTEGER,
      is_active                   INTEGER NOT NULL DEFAULT 1,
      is_suspended                INTEGER NOT NULL DEFAULT 0,
      suspension_reason           TEXT,
      created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id                    TEXT PRIMARY KEY,
      merchant_id           TEXT NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
      amount_bdt_poisha     INTEGER NOT NULL,
      rate_poisha_per_usdc  INTEGER NOT NULL,
      amount_usdc_units     INTEGER NOT NULL,
      customer_reference    TEXT,
      description           TEXT,
      customer_wallet_address TEXT,
      status                TEXT NOT NULL DEFAULT 'pending',
      expires_at            TEXT NOT NULL,
      paid_at               TEXT,
      cancelled_at          TEXT,
      cancel_reason         TEXT,
      auth_nonce            TEXT NOT NULL,
      auth_expires_at       TEXT NOT NULL,
      payment_id            TEXT,
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id                    TEXT PRIMARY KEY,
      invoice_id            TEXT NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
      merchant_id           TEXT NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
      tx_hash               TEXT NOT NULL UNIQUE,
      payer_wallet_address  TEXT NOT NULL,
      amount_usdc_units     INTEGER NOT NULL,
      amount_bdt_poisha     INTEGER NOT NULL,
      block_number          INTEGER,
      block_timestamp       TEXT,
      confirmations         INTEGER,
      status                TEXT NOT NULL DEFAULT 'confirmed',
      verified_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS merchant_ledger (
      id              TEXT PRIMARY KEY,
      merchant_id     TEXT NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
      entry_type      TEXT NOT NULL,
      amount_poisha   INTEGER NOT NULL,
      balance_after   INTEGER NOT NULL,
      payment_id      TEXT,
      payout_id       TEXT,
      description     TEXT,
      created_by      TEXT,
      created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id                    TEXT PRIMARY KEY,
      merchant_id           TEXT NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
      amount_bdt_poisha     INTEGER NOT NULL,
      payout_method         TEXT NOT NULL,
      payout_account_name   TEXT NOT NULL,
      payout_account_number TEXT NOT NULL,
      payout_bank_name      TEXT,
      status                TEXT NOT NULL DEFAULT 'pending',
      requested_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      initiated_at          TEXT,
      confirmed_at          TEXT,
      cancelled_at          TEXT,
      cancel_reason         TEXT,
      external_reference    TEXT,
      external_timestamp    TEXT,
      external_note         TEXT,
      ledger_entry_id       TEXT,
      created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          TEXT PRIMARY KEY,
      actor       TEXT NOT NULL DEFAULT 'admin',
      action      TEXT NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      details     TEXT,
      ip          TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    INSERT OR IGNORE INTO system_config (key, value) VALUES
      ('default_rate_poisha_per_usdc', '12500'),
      ('invoice_expiry_minutes', '30'),
      ('invoice_auth_expiry_minutes', '15');

    CREATE INDEX IF NOT EXISTS idx_merchants_slug ON merchants(slug);
    CREATE INDEX IF NOT EXISTS idx_merchants_user_id ON merchants(user_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_merchant_id ON invoices(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_payments_merchant_id ON payments(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_merchant_id ON merchant_ledger(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_merchant_id ON payouts(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
  `);
}

/** Generate a random UUID. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Node 14 fallback via require
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('crypto') as { randomUUID: () => string };
  return randomUUID();
}

/** Escape a LIKE pattern value (prevent injection via wildcard). */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

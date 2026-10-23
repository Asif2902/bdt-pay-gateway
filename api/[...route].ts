import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { getDb, newId, initDb, escapeLike } from '../lib/db';
import { withPublic, withAuth, withAdmin, type AuthedRequest } from '../lib/middleware';
import {
  loginUser, registerUser, signMerchantToken, getUserById,
  verifyAdminPassword, signAdminToken, verifyAdminToken,
} from '../lib/auth';
import { calcUsdcUnits, calcBdtPoisha } from '../lib/math';
import { signInvoiceAuthorization } from '../lib/signer';
import { verifyPayment, uuidToBytes32 } from '../lib/verifier';

const PAGE_SIZE = 20;

// ─── Schema definitions ───────────────────────────────────────────────────────

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().max(100).optional(),
});
const merchantCreateSchema = z.object({
  shop_name: z.string().min(1).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, hyphens only'),
  business_description: z.string().max(500).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(20).optional(),
  website_url: z.string().url().optional().or(z.literal('')),
});
const merchantUpdateSchema = merchantCreateSchema.partial().extend({
  payout_method: z.enum(['bkash', 'nagad', 'bank_transfer', 'other']).optional(),
  payout_account_name: z.string().max(100).optional(),
  payout_account_number: z.string().max(50).optional(),
  payout_bank_name: z.string().max(100).optional(),
  payout_bank_branch: z.string().max(100).optional(),
  payout_routing_number: z.string().max(50).optional(),
  custom_rate_poisha_per_usdc: z.number().int().positive().optional().nullable(),
});
const invoiceCreateSchema = z.object({
  amount_bdt_poisha: z.number().int().min(100, 'Minimum 1 BDT').max(10_000_000, 'Maximum 100,000 BDT'),
  customer_reference: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
});
const payoutRequestSchema = z.object({
  amount_bdt_poisha: z.number().int().min(100),
  payout_method: z.enum(['bkash', 'nagad', 'bank_transfer', 'other']),
  payout_account_name: z.string().min(1).max(100),
  payout_account_number: z.string().min(1).max(50),
  payout_bank_name: z.string().max(100).optional(),
});
const verifySchema = z.object({
  invoice_id: z.string().uuid(),
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  payer_wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
const suspendSchema = z.object({ reason: z.string().min(1) });
const cancelSchema = z.object({ reason: z.string().min(1) });
const confirmPayoutSchema = z.object({
  external_reference: z.string().min(1),
  external_timestamp: z.string().datetime(),
  external_note: z.string().max(500).optional(),
});
const adminLoginSchema = z.object({ password: z.string().min(1) });

// ─── Route helper ─────────────────────────────────────────────────────────────

function notAllowed(res: VercelResponse) {
  res.status(405).json({ success: false, error: 'Method not allowed' });
}
function notFound(res: VercelResponse) {
  res.status(404).json({ success: false, error: 'Not found' });
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

async function handleAuthLogin(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { notAllowed(res); return; }
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
  try {
    const user = await loginUser(parsed.data.email, parsed.data.password);
    if (!user.is_active) { res.status(403).json({ success: false, error: 'Account is deactivated' }); return; }
    const token = await signMerchantToken(user.id, user.email, user.role);
    res.json({ success: true, data: { token, user: { id: user.id, email: user.email, role: user.role } } });
  } catch (e) {
    res.status(401).json({ success: false, error: e instanceof Error ? e.message : 'Login failed' });
  }
}

async function handleAuthRegister(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { notAllowed(res); return; }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
  try {
    const user = await registerUser(parsed.data.email, parsed.data.password, parsed.data.full_name);
    const token = await signMerchantToken(user.id, user.email, user.role);
    res.status(201).json({ success: true, data: { token, user: { id: user.id, email: user.email, role: user.role } } });
  } catch (e) {
    res.status(409).json({ success: false, error: e instanceof Error ? e.message : 'Registration failed' });
  }
}

const handleAuthMe = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { notAllowed(res); return; }
  const user = await getUserById(req.userId);
  if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, data: { user } });
});

// ─── Merchant routes ──────────────────────────────────────────────────────────

const handleMerchants = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();

  if (req.method === 'GET') {
    const row = await db.execute({ sql: 'SELECT * FROM merchants WHERE user_id = ?', args: [req.userId] });
    res.json({ success: true, data: row.rows[0] ?? null });
    return;
  }
  if (req.method === 'POST') {
    const parsed = merchantCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    const d = parsed.data;
    const existing = await db.execute({ sql: 'SELECT id FROM merchants WHERE slug = ?', args: [d.slug] });
    if (existing.rows.length > 0) { res.status(409).json({ success: false, error: 'Slug already taken' }); return; }
    const alreadyMerchant = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
    if (alreadyMerchant.rows.length > 0) { res.status(409).json({ success: false, error: 'Already registered as merchant' }); return; }
    const id = newId();
    await db.execute({
      sql: `INSERT INTO merchants (id, user_id, shop_name, slug, business_description, contact_email, contact_phone, website_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, req.userId, d.shop_name, d.slug, d.business_description ?? null, d.contact_email ?? null, d.contact_phone ?? null, d.website_url ?? null],
    });
    const created = await db.execute({ sql: 'SELECT * FROM merchants WHERE id = ?', args: [id] });
    res.status(201).json({ success: true, data: created.rows[0] });
    return;
  }
  if (req.method === 'PUT') {
    const parsed = merchantUpdateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    const d = parsed.data;
    const merchant = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
    if (!merchant.rows[0]) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
    const merchantId = String(merchant.rows[0].id);
    const sets: string[] = [];
    const args: unknown[] = [];
    const fields = ['shop_name', 'slug', 'business_description', 'contact_email', 'contact_phone', 'website_url', 'payout_method', 'payout_account_name', 'payout_account_number', 'payout_bank_name', 'payout_bank_branch', 'payout_routing_number', 'custom_rate_poisha_per_usdc'] as const;
    for (const f of fields) {
      if (f in d && d[f] !== undefined) { sets.push(`${f} = ?`); args.push(d[f] ?? null); }
    }
    if (sets.length > 0) {
      sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
      args.push(merchantId);
      await db.execute({ sql: `UPDATE merchants SET ${sets.join(', ')} WHERE id = ?`, args: args as import('@libsql/client').InArgs });
    }
    const updated = await db.execute({ sql: 'SELECT * FROM merchants WHERE id = ?', args: [merchantId] });
    res.json({ success: true, data: updated.rows[0] });
    return;
  }
  notAllowed(res);
});

// ─── Invoice routes ───────────────────────────────────────────────────────────

const handleInvoices = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id, is_suspended, custom_rate_poisha_per_usdc FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];

  if (req.method === 'GET') {
    if (!merchant) { res.json({ success: true, data: { invoices: [], total: 0 } }); return; }
    const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
    const status = req.query?.status as string | undefined;
    const statusClause = status ? `AND status = ?` : '';
    const statusArgs = status ? [status] : [];
    const rows = await db.execute({
      sql: `SELECT * FROM invoices WHERE merchant_id = ? ${statusClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [String(merchant.id), ...statusArgs, PAGE_SIZE, page * PAGE_SIZE],
    });
    const countRow = await db.execute({
      sql: `SELECT COUNT(*) as c FROM invoices WHERE merchant_id = ? ${statusClause}`,
      args: [String(merchant.id), ...statusArgs],
    });
    res.json({ success: true, data: { invoices: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
    return;
  }
  if (req.method === 'POST') {
    const parsed = invoiceCreateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    if (!merchant) { res.status(404).json({ success: false, error: 'Complete merchant registration first' }); return; }
    if (Number(merchant.is_suspended)) { res.status(403).json({ success: false, error: 'Account is suspended' }); return; }
    let rate = Number(merchant.custom_rate_poisha_per_usdc);
    if (!rate) {
      const cfg = await db.execute({ sql: `SELECT value FROM system_config WHERE key = 'default_rate_poisha_per_usdc'`, args: [] });
      rate = parseInt(String(cfg.rows[0]?.value ?? '12500'), 10);
    }
    const body = parsed.data;
    const amountUsdcUnits = calcUsdcUnits(body.amount_bdt_poisha, rate);
    const nonce = randomBytes(32).toString('hex');
    const cfgExpiry = await db.execute({ sql: `SELECT value FROM system_config WHERE key = 'invoice_expiry_minutes'`, args: [] });
    const cfgAuth = await db.execute({ sql: `SELECT value FROM system_config WHERE key = 'invoice_auth_expiry_minutes'`, args: [] });
    const expiryMin = parseInt(String(cfgExpiry.rows[0]?.value ?? '30'), 10);
    const authMin = parseInt(String(cfgAuth.rows[0]?.value ?? '15'), 10);
    const now = Date.now();
    const expiresAt = new Date(now + expiryMin * 60_000).toISOString();
    const authExpiresAt = new Date(now + authMin * 60_000).toISOString();
    const id = newId();
    await db.execute({
      sql: `INSERT INTO invoices (id, merchant_id, amount_bdt_poisha, rate_poisha_per_usdc, amount_usdc_units, customer_reference, description, expires_at, auth_nonce, auth_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, String(merchant.id), body.amount_bdt_poisha, rate, amountUsdcUnits, body.customer_reference ?? null, body.description ?? null, expiresAt, nonce, authExpiresAt],
    });
    const created = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [id] });
    res.status(201).json({ success: true, data: { invoice: created.rows[0], checkout_url: `/pay/${id}` } });
    return;
  }
  notAllowed(res);
});

const handleInvoiceById = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();
  const invoiceId = req.query?.id as string;
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { notFound(res); return; }

  if (req.method === 'GET') {
    const row = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ? AND merchant_id = ?', args: [invoiceId, String(merchant.id)] });
    if (!row.rows[0]) { notFound(res); return; }
    res.json({ success: true, data: row.rows[0] });
    return;
  }
  if (req.method === 'POST') {
    const row = await db.execute({ sql: 'SELECT id, status FROM invoices WHERE id = ? AND merchant_id = ?', args: [invoiceId, String(merchant.id)] });
    const invoice = row.rows[0];
    if (!invoice) { notFound(res); return; }
    if (String(invoice.status) !== 'pending') { res.status(409).json({ success: false, error: `Cannot cancel ${invoice.status} invoice` }); return; }
    await db.execute({ sql: `UPDATE invoices SET status='cancelled', cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [invoiceId] });
    res.json({ success: true, data: { ok: true } });
    return;
  }
  notAllowed(res);
});

// ─── Payment routes ───────────────────────────────────────────────────────────

const handlePayments = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { notAllowed(res); return; }
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.json({ success: true, data: { payments: [], total: 0 } }); return; }
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const rows = await db.execute({
    sql: 'SELECT * FROM payments WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    args: [String(merchant.id), PAGE_SIZE, page * PAGE_SIZE],
  });
  const countRow = await db.execute({ sql: 'SELECT COUNT(*) as c FROM payments WHERE merchant_id = ?', args: [String(merchant.id)] });
  res.json({ success: true, data: { payments: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

const handleVerify = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'POST') { notAllowed(res); return; }
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
  const { invoice_id, tx_hash, payer_wallet_address } = parsed.data;
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
  const invoiceRow = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ? AND merchant_id = ?', args: [invoice_id, String(merchant.id)] });
  const invoice = invoiceRow.rows[0];
  if (!invoice) { res.status(404).json({ success: false, error: 'Invoice not found' }); return; }
  if (String(invoice.status) !== 'pending') { res.status(409).json({ success: false, error: 'Invoice already processed' }); return; }
  const dupCheck = await db.execute({ sql: 'SELECT id FROM payments WHERE tx_hash = ?', args: [tx_hash] });
  if (dupCheck.rows.length > 0) { res.status(409).json({ success: false, error: 'Transaction already recorded' }); return; }
  const contractAddress = process.env.VITE_GATEWAY_CONTRACT_ADDRESS;
  if (!contractAddress) { res.status(500).json({ success: false, error: 'Gateway contract address not configured' }); return; }
  const result = await verifyPayment(tx_hash, contractAddress, uuidToBytes32(invoice_id), uuidToBytes32(String(merchant.id)), BigInt(Number(invoice.amount_usdc_units)));
  if (!result.ok) { res.status(422).json({ success: false, error: result.error }); return; }
  const bdtAmount = calcBdtPoisha(Number(invoice.amount_usdc_units), Number(invoice.rate_poisha_per_usdc));
  const balRow = await db.execute({ sql: `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?`, args: [String(merchant.id)] });
  const currentBalance = Number(balRow.rows[0]?.bal ?? 0);
  const newBalance = currentBalance + bdtAmount;
  const paymentId = newId();
  const ledgerId = newId();
  await db.batch([
    { sql: `INSERT INTO payments (id, invoice_id, merchant_id, tx_hash, payer_wallet_address, amount_usdc_units, amount_bdt_poisha, block_number, block_timestamp, confirmations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [paymentId, invoice_id, String(merchant.id), tx_hash, payer_wallet_address, Number(invoice.amount_usdc_units), bdtAmount, Number(result.blockNumber ?? 0), result.blockTimestamp ? new Date(Number(result.blockTimestamp) * 1000).toISOString() : null, result.confirmations ?? 0] },
    { sql: `UPDATE invoices SET status='paid', paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), customer_wallet_address=?, payment_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [payer_wallet_address, paymentId, invoice_id] },
    { sql: `INSERT INTO merchant_ledger (id, merchant_id, entry_type, amount_poisha, balance_after, payment_id, description) VALUES (?, ?, 'credit', ?, ?, ?, ?)`, args: [ledgerId, String(merchant.id), bdtAmount, newBalance, paymentId, `Payment for invoice ${invoice_id.slice(0, 8)}`] },
  ]);
  res.json({ success: true, data: { payment_id: paymentId, amount_bdt_poisha: bdtAmount, new_balance: newBalance } });
});

// ─── Ledger routes ────────────────────────────────────────────────────────────

const handleLedger = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { notAllowed(res); return; }
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.json({ success: true, data: { balance: 0, entries: [], total: 0 } }); return; }
  const mid = String(merchant.id);
  const balRow = await db.execute({ sql: `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?`, args: [mid] });
  const balance = Number(balRow.rows[0]?.bal ?? 0);
  if (req.query?.balance_only === 'true') { res.json({ success: true, data: { balance } }); return; }
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const rows = await db.execute({ sql: 'SELECT * FROM merchant_ledger WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', args: [mid, PAGE_SIZE, page * PAGE_SIZE] });
  const countRow = await db.execute({ sql: 'SELECT COUNT(*) as c FROM merchant_ledger WHERE merchant_id = ?', args: [mid] });
  res.json({ success: true, data: { balance, entries: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

// ─── Payout routes ────────────────────────────────────────────────────────────

const handlePayouts = withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
  const mid = String(merchant.id);

  if (req.method === 'GET') {
    const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
    const rows = await db.execute({ sql: 'SELECT * FROM payouts WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', args: [mid, PAGE_SIZE, page * PAGE_SIZE] });
    res.json({ success: true, data: { payouts: rows.rows } });
    return;
  }
  if (req.method === 'POST') {
    const parsed = payoutRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    const d = parsed.data;
    const balRow = await db.execute({ sql: `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?`, args: [mid] });
    const balance = Number(balRow.rows[0]?.bal ?? 0);
    if (balance < d.amount_bdt_poisha) { res.status(422).json({ success: false, error: `Insufficient balance. Available: ${balance} poisha` }); return; }
    const pending = await db.execute({ sql: `SELECT id FROM payouts WHERE merchant_id = ? AND status IN ('pending','processing')`, args: [mid] });
    if (pending.rows.length > 0) { res.status(409).json({ success: false, error: 'A payout request is already pending' }); return; }
    const id = newId();
    await db.execute({ sql: `INSERT INTO payouts (id, merchant_id, amount_bdt_poisha, payout_method, payout_account_name, payout_account_number, payout_bank_name) VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [id, mid, d.amount_bdt_poisha, d.payout_method, d.payout_account_name, d.payout_account_number, d.payout_bank_name ?? null] });
    const created = await db.execute({ sql: 'SELECT * FROM payouts WHERE id = ?', args: [id] });
    res.status(201).json({ success: true, data: { payout: created.rows[0] } });
    return;
  }
  notAllowed(res);
});

// ─── Public routes ────────────────────────────────────────────────────────────

async function handlePublicInvoice(req: VercelRequest, res: VercelResponse) {
  const invoiceId = req.query?.id as string;
  if (!invoiceId) { notFound(res); return; }
  const db = getDb();

  if (req.method === 'GET') {
    const invoiceRow = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [invoiceId] });
    const invoice = invoiceRow.rows[0];
    if (!invoice) { notFound(res); return; }
    const merchantRow = await db.execute({ sql: 'SELECT id, shop_name, slug, contact_email FROM merchants WHERE id = ?', args: [String(invoice.merchant_id)] });
    res.json({ success: true, data: { invoice, merchant: merchantRow.rows[0] } });
    return;
  }
  if (req.method === 'POST') {
    const invoiceRow = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [invoiceId] });
    const invoice = invoiceRow.rows[0];
    if (!invoice) { notFound(res); return; }
    if (String(invoice.status) !== 'pending') { res.status(409).json({ success: false, error: 'Invoice not payable' }); return; }
    if (new Date(String(invoice.expires_at)) < new Date()) { res.status(410).json({ success: false, error: 'Invoice expired' }); return; }
    const contractAddress = process.env.VITE_GATEWAY_CONTRACT_ADDRESS as `0x${string}`;
    if (!contractAddress) { res.status(500).json({ success: false, error: 'Gateway contract not configured' }); return; }
    const authExpiry = Math.floor(new Date(String(invoice.auth_expires_at)).getTime() / 1000);
    const nonce = `0x${String(invoice.auth_nonce).padEnd(64, '0')}` as `0x${string}`;
    const signed = await signInvoiceAuthorization(contractAddress, uuidToBytes32(invoiceId), uuidToBytes32(String(invoice.merchant_id)), BigInt(Number(invoice.amount_usdc_units)), BigInt(authExpiry), nonce);
    res.json({ success: true, data: signed });
    return;
  }
  notAllowed(res);
}

async function handlePublicRate(_req: VercelRequest, res: VercelResponse) {
  const db = getDb();
  const cfg = await db.execute({ sql: `SELECT value FROM system_config WHERE key = 'default_rate_poisha_per_usdc'`, args: [] });
  const rate = parseInt(String(cfg.rows[0]?.value ?? '12500'), 10);
  res.json({ success: true, data: { rate_poisha_per_usdc: rate, display: `৳${rate / 100}/USDC` } });
}

// ─── Admin routes ─────────────────────────────────────────────────────────────

async function handleAdminAuth(req: VercelRequest, res: VercelResponse) {
  await initDb();
  if (req.method === 'POST') {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: 'Password required' }); return; }
    try {
      const ok = await verifyAdminPassword(parsed.data.password);
      if (!ok) { res.status(401).json({ success: false, error: 'Invalid password' }); return; }
      const { token } = await signAdminToken();
      res.setHeader('Set-Cookie', `admin_token=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800`);
      res.json({ success: true, data: { token } });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Login failed' });
    }
    return;
  }
  if (req.method === 'GET') {
    const authHeader = req.headers.authorization;
    const cookieToken = (req.headers.cookie ?? '').match(/admin_token=([^;]+)/)?.[1];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (cookieToken ? decodeURIComponent(cookieToken) : null);
    if (!token) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
    try { await verifyAdminToken(token); res.json({ success: true, data: { role: 'admin' } }); }
    catch { res.status(401).json({ success: false, error: 'Invalid or expired token' }); }
    return;
  }
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
    res.json({ success: true, data: { ok: true } });
    return;
  }
  notAllowed(res);
}

const handleAdminMerchants = withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { notAllowed(res); return; }
  const db = getDb();
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const search = String(req.query?.search ?? '');
  const searchClause = search ? `WHERE (m.shop_name LIKE ? ESCAPE '\\' OR m.slug LIKE ? ESCAPE '\\')` : '';
  const searchArgs = search ? [`%${escapeLike(search)}%`, `%${escapeLike(search)}%`] : [];
  const rows = await db.execute({ sql: `SELECT m.*, u.email FROM merchants m JOIN users u ON u.id = m.user_id ${searchClause} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, args: [...searchArgs, PAGE_SIZE, page * PAGE_SIZE] });
  const countRow = await db.execute({ sql: `SELECT COUNT(*) as c FROM merchants m ${searchClause}`, args: searchArgs });
  res.json({ success: true, data: { merchants: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

const handleAdminMerchantById = withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') { notAllowed(res); return; }
  const db = getDb();
  const merchantId = req.query?.id as string;
  const action = req.query?.action as string;
  if (action === 'suspend') {
    const parsed = suspendSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: 'Reason required' }); return; }
    await db.execute({ sql: `UPDATE merchants SET is_suspended=1, suspension_reason=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [parsed.data.reason, merchantId] });
    await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id, details) VALUES (?, 'merchant_suspended', 'merchant', ?, ?)`, args: [newId(), merchantId, JSON.stringify({ reason: parsed.data.reason })] });
    res.json({ success: true, data: { ok: true } }); return;
  }
  if (action === 'activate') {
    await db.execute({ sql: `UPDATE merchants SET is_suspended=0, suspension_reason=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [merchantId] });
    await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id) VALUES (?, 'merchant_activated', 'merchant', ?)`, args: [newId(), merchantId] });
    res.json({ success: true, data: { ok: true } }); return;
  }
  res.status(400).json({ success: false, error: 'Unknown action' });
});

const handleAdminPayments = withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { notAllowed(res); return; }
  const db = getDb();
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const search = String(req.query?.search ?? '');
  const searchClause = search ? `WHERE (p.tx_hash LIKE ? ESCAPE '\\' OR p.payer_wallet_address LIKE ? ESCAPE '\\')` : '';
  const searchArgs = search ? [`%${escapeLike(search)}%`, `%${escapeLike(search)}%`] : [];
  const rows = await db.execute({ sql: `SELECT p.*, m.shop_name FROM payments p JOIN merchants m ON m.id = p.merchant_id ${searchClause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, args: [...searchArgs, PAGE_SIZE, page * PAGE_SIZE] });
  const countRow = await db.execute({ sql: `SELECT COUNT(*) as c FROM payments p ${searchClause}`, args: searchArgs });
  res.json({ success: true, data: { payments: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

const handleAdminPayouts = withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { notAllowed(res); return; }
  const db = getDb();
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const rows = await db.execute({ sql: `SELECT po.*, m.shop_name, m.slug FROM payouts po JOIN merchants m ON m.id = po.merchant_id WHERE po.status IN ('pending','processing') ORDER BY po.created_at ASC LIMIT ? OFFSET ?`, args: [PAGE_SIZE, page * PAGE_SIZE] });
  const countRow = await db.execute({ sql: `SELECT COUNT(*) as c FROM payouts WHERE status IN ('pending','processing')`, args: [] });
  res.json({ success: true, data: { payouts: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

const handleAdminPayoutById = withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') { notAllowed(res); return; }
  const db = getDb();
  const payoutId = req.query?.id as string;
  const action = req.query?.action as string;
  const payoutRow = await db.execute({ sql: 'SELECT * FROM payouts WHERE id = ?', args: [payoutId] });
  const payout = payoutRow.rows[0];
  if (!payout) { notFound(res); return; }
  if (action === 'initiate') {
    if (String(payout.status) !== 'pending') { res.status(409).json({ success: false, error: `Payout is already ${payout.status}` }); return; }
    await db.execute({ sql: `UPDATE payouts SET status='processing', initiated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [payoutId] });
    await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id) VALUES (?, 'payout_initiated', 'payout', ?)`, args: [newId(), payoutId] });
    res.json({ success: true, data: { ok: true } }); return;
  }
  if (action === 'confirm') {
    const parsed = confirmPayoutSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    if (String(payout.status) === 'completed') { res.status(409).json({ success: false, error: 'Already confirmed' }); return; }
    const mid = String(payout.merchant_id);
    const balRow = await db.execute({ sql: `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?`, args: [mid] });
    const balance = Number(balRow.rows[0]?.bal ?? 0);
    if (balance < Number(payout.amount_bdt_poisha)) { res.status(422).json({ success: false, error: 'Insufficient merchant balance' }); return; }
    const ledgerId = newId();
    await db.batch([
      { sql: `INSERT INTO merchant_ledger (id, merchant_id, entry_type, amount_poisha, balance_after, payout_id, description) VALUES (?, ?, 'debit', ?, ?, ?, ?)`, args: [ledgerId, mid, Number(payout.amount_bdt_poisha), balance - Number(payout.amount_bdt_poisha), payoutId, `BDT payout: ref ${parsed.data.external_reference}`] },
      { sql: `UPDATE payouts SET status='completed', confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), external_reference=?, external_timestamp=?, external_note=?, ledger_entry_id=? WHERE id=?`, args: [parsed.data.external_reference, parsed.data.external_timestamp, parsed.data.external_note ?? null, ledgerId, payoutId] },
    ]);
    await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id, details) VALUES (?, 'payout_confirmed', 'payout', ?, ?)`, args: [newId(), payoutId, JSON.stringify({ external_reference: parsed.data.external_reference, amount: payout.amount_bdt_poisha })] });
    res.json({ success: true, data: { ok: true } }); return;
  }
  if (action === 'cancel') {
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: 'Reason required' }); return; }
    if (String(payout.status) === 'completed') { res.status(409).json({ success: false, error: 'Cannot cancel completed payout' }); return; }
    await db.execute({ sql: `UPDATE payouts SET status='cancelled', cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), cancel_reason=? WHERE id=?`, args: [parsed.data.reason, payoutId] });
    await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id) VALUES (?, 'payout_cancelled', 'payout', ?)`, args: [newId(), payoutId] });
    res.json({ success: true, data: { ok: true } }); return;
  }
  res.status(400).json({ success: false, error: 'Unknown action' });
});

const handleAdminAudit = withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { notAllowed(res); return; }
  const db = getDb();
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const rows = await db.execute({ sql: 'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50 OFFSET ?', args: [page * 50] });
  res.json({ success: true, data: { logs: rows.rows } });
});

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export default withPublic(async (req: VercelRequest, res: VercelResponse) => {
  await initDb();

  const segments = (req.query?.route as string[] | undefined) ?? [];
  const path = '/' + segments.join('/');

  // Auth
  if (path === '/auth/login') return handleAuthLogin(req, res);
  if (path === '/auth/register') return handleAuthRegister(req, res);
  if (path === '/auth/me') return handleAuthMe(req, res);

  // Merchant
  if (path === '/merchants') return handleMerchants(req, res);

  // Invoices
  if (path === '/invoices') return handleInvoices(req, res);
  if (path.startsWith('/invoices/') && segments.length === 2) {
    req.query.id = segments[1]; return handleInvoiceById(req, res);
  }

  // Payments
  if (path === '/payments') return handlePayments(req, res);
  if (path === '/payments/verify') return handleVerify(req, res);

  // Ledger
  if (path === '/ledger') return handleLedger(req, res);

  // Payouts
  if (path === '/payouts') return handlePayouts(req, res);

  // Public
  if (path === '/public/rate') return handlePublicRate(req, res);
  if (path.startsWith('/public/invoice/') && segments.length === 3) {
    req.query.id = segments[2]; return handlePublicInvoice(req, res);
  }

  // Admin auth (no admin middleware — manages its own auth)
  if (path === '/admin/auth') return handleAdminAuth(req, res);

  // Admin (protected)
  if (path === '/admin/merchants') return handleAdminMerchants(req, res);
  if (path.startsWith('/admin/merchants/') && segments.length === 3) {
    req.query.id = segments[2]; return handleAdminMerchantById(req, res);
  }
  if (path === '/admin/payments') return handleAdminPayments(req, res);
  if (path === '/admin/payouts') return handleAdminPayouts(req, res);
  if (path.startsWith('/admin/payouts/') && segments.length === 3) {
    req.query.id = segments[2]; return handleAdminPayoutById(req, res);
  }
  if (path === '/admin/audit') return handleAdminAudit(req, res);

  notFound(res);
});

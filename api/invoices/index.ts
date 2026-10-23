import type { VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getDb, newId } from '../../lib/db';
import { calcUsdcUnits } from '../../lib/math';

const PAGE_SIZE = 20;

const createSchema = z.object({
  amount_bdt_poisha: z.number().int().min(100, 'Minimum 1 BDT').max(10_000_000, 'Maximum 100,000 BDT'),
  customer_reference: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
});

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id, is_suspended, custom_rate_poisha_per_usdc FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];

  if (req.method === 'GET') {
    if (!merchant) { res.json({ success: true, data: { invoices: [], total: 0 } }); return; }
    const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
    const status = req.query?.status as string | undefined;
    const offset = page * PAGE_SIZE;
    const statusClause = status ? `AND status = ?` : '';
    const statusArgs = status ? [status] : [];
    const rows = await db.execute({
      sql: `SELECT * FROM invoices WHERE merchant_id = ? ${statusClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [String(merchant.id), ...statusArgs, PAGE_SIZE, offset],
    });
    const countRow = await db.execute({
      sql: `SELECT COUNT(*) as c FROM invoices WHERE merchant_id = ? ${statusClause}`,
      args: [String(merchant.id), ...statusArgs],
    });
    res.json({ success: true, data: { invoices: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
    return;
  }

  if (req.method === 'POST') {
    const parsed = createSchema.safeParse(req.body);
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

  res.status(405).json({ success: false, error: 'Method not allowed' });
});

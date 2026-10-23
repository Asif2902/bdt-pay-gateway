import type { VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getDb, newId } from '../../lib/db';

const PAGE_SIZE = 20;

const requestSchema = z.object({
  amount_bdt_poisha: z.number().int().min(100),
  payout_method: z.enum(['bkash', 'nagad', 'bank_transfer', 'other']),
  payout_account_name: z.string().min(1).max(100),
  payout_account_number: z.string().min(1).max(50),
  payout_bank_name: z.string().max(100).optional(),
});

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
  const mid = String(merchant.id);

  if (req.method === 'GET') {
    const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
    const rows = await db.execute({
      sql: 'SELECT * FROM payouts WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      args: [mid, PAGE_SIZE, page * PAGE_SIZE],
    });
    res.json({ success: true, data: { payouts: rows.rows } });
    return;
  }

  if (req.method === 'POST') {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    const d = parsed.data;

    // Check balance
    const balRow = await db.execute({
      sql: `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?`,
      args: [mid],
    });
    const balance = Number(balRow.rows[0]?.bal ?? 0);
    if (balance < d.amount_bdt_poisha) { res.status(422).json({ success: false, error: `Insufficient balance. Available: ${balance} poisha` }); return; }

    // Check no pending payout
    const pending = await db.execute({ sql: `SELECT id FROM payouts WHERE merchant_id = ? AND status IN ('pending','processing')`, args: [mid] });
    if (pending.rows.length > 0) { res.status(409).json({ success: false, error: 'A payout request is already pending' }); return; }

    const id = newId();
    await db.execute({
      sql: `INSERT INTO payouts (id, merchant_id, amount_bdt_poisha, payout_method, payout_account_name, payout_account_number, payout_bank_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, mid, d.amount_bdt_poisha, d.payout_method, d.payout_account_name, d.payout_account_number, d.payout_bank_name ?? null],
    });
    const created = await db.execute({ sql: 'SELECT * FROM payouts WHERE id = ?', args: [id] });
    res.status(201).json({ success: true, data: { payout: created.rows[0] } });
    return;
  }

  res.status(405).json({ success: false, error: 'Method not allowed' });
});

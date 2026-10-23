import type { VercelResponse } from '@vercel/node';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getDb } from '../../lib/db';

const PAGE_SIZE = 20;

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.json({ success: true, data: { balance: 0, entries: [], total: 0 } }); return; }

  const mid = String(merchant.id);
  const balRow = await db.execute({
    sql: `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?`,
    args: [mid],
  });
  const balance = Number(balRow.rows[0]?.bal ?? 0);

  if (req.query?.balance_only === 'true') { res.json({ success: true, data: { balance } }); return; }

  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const rows = await db.execute({
    sql: 'SELECT * FROM merchant_ledger WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    args: [mid, PAGE_SIZE, page * PAGE_SIZE],
  });
  const countRow = await db.execute({ sql: 'SELECT COUNT(*) as c FROM merchant_ledger WHERE merchant_id = ?', args: [mid] });
  res.json({ success: true, data: { balance, entries: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

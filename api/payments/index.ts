import type { VercelResponse } from '@vercel/node';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getDb } from '../../lib/db';

const PAGE_SIZE = 20;

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
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

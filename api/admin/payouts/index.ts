import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAdmin } from '../../../lib/middleware';
import { getDb } from '../../../lib/db';

const PAGE_SIZE = 20;

export default withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const db = getDb();
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const rows = await db.execute({
    sql: `SELECT po.*, m.shop_name, m.slug FROM payouts po JOIN merchants m ON m.id = po.merchant_id WHERE po.status IN ('pending','processing') ORDER BY po.created_at ASC LIMIT ? OFFSET ?`,
    args: [PAGE_SIZE, page * PAGE_SIZE],
  });
  const countRow = await db.execute({ sql: `SELECT COUNT(*) as c FROM payouts WHERE status IN ('pending','processing')`, args: [] });
  res.json({ success: true, data: { payouts: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

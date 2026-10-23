import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAdmin } from '../../../lib/middleware';
import { getDb, escapeLike } from '../../../lib/db';

const PAGE_SIZE = 20;

export default withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const db = getDb();
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const search = String(req.query?.search ?? '');
  const searchClause = search ? `WHERE (p.tx_hash LIKE ? ESCAPE '\\' OR p.payer_wallet_address LIKE ? ESCAPE '\\')` : '';
  const searchArgs = search ? [`%${escapeLike(search)}%`, `%${escapeLike(search)}%`] : [];
  const rows = await db.execute({
    sql: `SELECT p.*, m.shop_name FROM payments p JOIN merchants m ON m.id = p.merchant_id ${searchClause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    args: [...searchArgs, PAGE_SIZE, page * PAGE_SIZE],
  });
  const countRow = await db.execute({ sql: `SELECT COUNT(*) as c FROM payments p ${searchClause}`, args: searchArgs });
  res.json({ success: true, data: { payments: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
});

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAdmin } from '../../../lib/middleware';
import { getDb, escapeLike } from '../../../lib/db';

const PAGE_SIZE = 20;

export default withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  const db = getDb();

  if (req.method === 'GET') {
    const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
    const search = String(req.query?.search ?? '');
    const searchClause = search ? `WHERE (m.shop_name LIKE ? ESCAPE '\\' OR m.slug LIKE ? ESCAPE '\\')` : '';
    const searchArgs = search ? [`%${escapeLike(search)}%`, `%${escapeLike(search)}%`] : [];
    const rows = await db.execute({
      sql: `SELECT m.*, u.email FROM merchants m JOIN users u ON u.id = m.user_id ${searchClause} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
      args: [...searchArgs, PAGE_SIZE, page * PAGE_SIZE],
    });
    const countRow = await db.execute({
      sql: `SELECT COUNT(*) as c FROM merchants m ${searchClause}`,
      args: searchArgs,
    });
    res.json({ success: true, data: { merchants: rows.rows, total: Number(countRow.rows[0]?.c ?? 0) } });
    return;
  }

  res.status(405).json({ success: false, error: 'Method not allowed' });
});

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAdmin } from '../../lib/middleware';
import { getDb } from '../../lib/db';

export default withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const db = getDb();
  const page = Math.max(0, parseInt(String(req.query?.page ?? '0'), 10));
  const rows = await db.execute({ sql: 'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 50 OFFSET ?', args: [page * 50] });
  res.json({ success: true, data: { logs: rows.rows } });
});

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withPublic } from '../../lib/middleware';
import { getDb } from '../../lib/db';

export default withPublic(async (_req: VercelRequest, res: VercelResponse) => {
  const db = getDb();
  const cfg = await db.execute({ sql: `SELECT value FROM system_config WHERE key = 'default_rate_poisha_per_usdc'`, args: [] });
  const rate = parseInt(String(cfg.rows[0]?.value ?? '12500'), 10);
  res.json({ success: true, data: { rate_poisha_per_usdc: rate, display: `৳${rate / 100}/USDC` } });
});

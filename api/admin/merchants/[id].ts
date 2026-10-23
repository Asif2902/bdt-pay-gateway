import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAdmin } from '../../../lib/middleware';
import { getDb, newId } from '../../../lib/db';

const suspendSchema = z.object({ reason: z.string().min(1) });

export default withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  const db = getDb();
  const merchantId = req.query?.id as string;
  const action = req.query?.action as string;

  if (req.method === 'POST') {
    if (action === 'suspend') {
      const parsed = suspendSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ success: false, error: 'Reason required' }); return; }
      await db.execute({ sql: `UPDATE merchants SET is_suspended=1, suspension_reason=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [parsed.data.reason, merchantId] });
      await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id, details) VALUES (?, 'merchant_suspended', 'merchant', ?, ?)`, args: [newId(), merchantId, JSON.stringify({ reason: parsed.data.reason })] });
      res.json({ success: true, data: { ok: true } });
      return;
    }
    if (action === 'activate') {
      await db.execute({ sql: `UPDATE merchants SET is_suspended=0, suspension_reason=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [merchantId] });
      await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id) VALUES (?, 'merchant_activated', 'merchant', ?)`, args: [newId(), merchantId] });
      res.json({ success: true, data: { ok: true } });
      return;
    }
    res.status(400).json({ success: false, error: 'Unknown action' });
    return;
  }

  res.status(405).json({ success: false, error: 'Method not allowed' });
});

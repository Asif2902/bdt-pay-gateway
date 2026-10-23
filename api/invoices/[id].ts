import type { VercelResponse } from '@vercel/node';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getDb } from '../../lib/db';

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();
  const invoiceId = req.query?.id as string;
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.status(404).json({ success: false, error: 'Not found' }); return; }

  if (req.method === 'GET') {
    const row = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ? AND merchant_id = ?', args: [invoiceId, String(merchant.id)] });
    if (!row.rows[0]) { res.status(404).json({ success: false, error: 'Invoice not found' }); return; }
    res.json({ success: true, data: row.rows[0] });
    return;
  }

  if (req.method === 'POST') {
    // cancel
    const row = await db.execute({ sql: 'SELECT id, status FROM invoices WHERE id = ? AND merchant_id = ?', args: [invoiceId, String(merchant.id)] });
    const invoice = row.rows[0];
    if (!invoice) { res.status(404).json({ success: false, error: 'Invoice not found' }); return; }
    if (String(invoice.status) !== 'pending') { res.status(409).json({ success: false, error: `Cannot cancel ${invoice.status} invoice` }); return; }
    await db.execute({ sql: `UPDATE invoices SET status='cancelled', cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [invoiceId] });
    res.json({ success: true, data: { ok: true } });
    return;
  }

  res.status(405).json({ success: false, error: 'Method not allowed' });
});

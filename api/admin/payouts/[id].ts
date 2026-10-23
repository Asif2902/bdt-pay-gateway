import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAdmin } from '../../../lib/middleware';
import { getDb, newId } from '../../../lib/db';

const confirmSchema = z.object({
  external_reference: z.string().min(1),
  external_timestamp: z.string().datetime(),
  external_note: z.string().max(500).optional(),
});
const cancelSchema = z.object({ reason: z.string().min(1) });

export default withAdmin(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const db = getDb();
  const payoutId = req.query?.id as string;
  const action = req.query?.action as string;

  const payoutRow = await db.execute({ sql: 'SELECT * FROM payouts WHERE id = ?', args: [payoutId] });
  const payout = payoutRow.rows[0];
  if (!payout) { res.status(404).json({ success: false, error: 'Payout not found' }); return; }

  if (action === 'initiate') {
    if (String(payout.status) !== 'pending') { res.status(409).json({ success: false, error: `Payout is already ${payout.status}` }); return; }
    await db.execute({ sql: `UPDATE payouts SET status='processing', initiated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`, args: [payoutId] });
    await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id) VALUES (?, 'payout_initiated', 'payout', ?)`, args: [newId(), payoutId] });
    res.json({ success: true, data: { ok: true } });
    return;
  }

  if (action === 'confirm') {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    if (String(payout.status) === 'completed') { res.status(409).json({ success: false, error: 'Already confirmed' }); return; }

    // Check balance
    const mid = String(payout.merchant_id);
    const balRow = await db.execute({
      sql: `SELECT COALESCE(SUM(CASE WHEN entry_type='credit' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?`,
      args: [mid],
    });
    const balance = Number(balRow.rows[0]?.bal ?? 0);
    if (balance < Number(payout.amount_bdt_poisha)) { res.status(422).json({ success: false, error: 'Insufficient merchant balance' }); return; }

    const ledgerId = newId();
    await db.batch([
      {
        sql: `INSERT INTO merchant_ledger (id, merchant_id, entry_type, amount_poisha, balance_after, payout_id, description) VALUES (?, ?, 'debit', ?, ?, ?, ?)`,
        args: [ledgerId, mid, Number(payout.amount_bdt_poisha), balance - Number(payout.amount_bdt_poisha), payoutId, `BDT payout: ref ${parsed.data.external_reference}`],
      },
      {
        sql: `UPDATE payouts SET status='completed', confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), external_reference=?, external_timestamp=?, external_note=?, ledger_entry_id=? WHERE id=?`,
        args: [parsed.data.external_reference, parsed.data.external_timestamp, parsed.data.external_note ?? null, ledgerId, payoutId],
      },
    ]);
    await db.execute({
      sql: `INSERT INTO audit_log (id, action, target_type, target_id, details) VALUES (?, 'payout_confirmed', 'payout', ?, ?)`,
      args: [newId(), payoutId, JSON.stringify({ external_reference: parsed.data.external_reference, amount: payout.amount_bdt_poisha })],
    });
    res.json({ success: true, data: { ok: true } });
    return;
  }

  if (action === 'cancel') {
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: 'Reason required' }); return; }
    if (String(payout.status) === 'completed') { res.status(409).json({ success: false, error: 'Cannot cancel completed payout' }); return; }
    await db.execute({
      sql: `UPDATE payouts SET status='cancelled', cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), cancel_reason=? WHERE id=?`,
      args: [parsed.data.reason, payoutId],
    });
    await db.execute({ sql: `INSERT INTO audit_log (id, action, target_type, target_id) VALUES (?, 'payout_cancelled', 'payout', ?)`, args: [newId(), payoutId] });
    res.json({ success: true, data: { ok: true } });
    return;
  }

  res.status(400).json({ success: false, error: 'Unknown action' });
});

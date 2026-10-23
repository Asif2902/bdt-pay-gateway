import type { VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getDb, newId } from '../../lib/db';
import { verifyPayment, uuidToBytes32 } from '../../lib/verifier';
import { calcBdtPoisha } from '../../lib/math';

const schema = z.object({
  invoice_id: z.string().uuid(),
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  payer_wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
  const { invoice_id, tx_hash, payer_wallet_address } = parsed.data;

  const db = getDb();
  const merchantRow = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
  const merchant = merchantRow.rows[0];
  if (!merchant) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }

  const invoiceRow = await db.execute({
    sql: 'SELECT * FROM invoices WHERE id = ? AND merchant_id = ?',
    args: [invoice_id, String(merchant.id)],
  });
  const invoice = invoiceRow.rows[0];
  if (!invoice) { res.status(404).json({ success: false, error: 'Invoice not found' }); return; }
  if (String(invoice.status) !== 'pending') { res.status(409).json({ success: false, error: 'Invoice already processed' }); return; }

  // Check for duplicate tx
  const dupCheck = await db.execute({ sql: 'SELECT id FROM payments WHERE tx_hash = ?', args: [tx_hash] });
  if (dupCheck.rows.length > 0) { res.status(409).json({ success: false, error: 'Transaction already recorded' }); return; }

  const contractAddress = process.env.VITE_GATEWAY_CONTRACT_ADDRESS;
  if (!contractAddress) { res.status(500).json({ success: false, error: 'Gateway contract address not configured' }); return; }

  const result = await verifyPayment(
    tx_hash,
    contractAddress,
    uuidToBytes32(invoice_id),
    uuidToBytes32(String(merchant.id)),
    BigInt(Number(invoice.amount_usdc_units)),
  );

  if (!result.ok) { res.status(422).json({ success: false, error: result.error }); return; }

  const bdtAmount = calcBdtPoisha(Number(invoice.amount_usdc_units), Number(invoice.rate_poisha_per_usdc));

  // Get current balance
  const balRow = await db.execute({
    sql: 'SELECT COALESCE(SUM(CASE WHEN entry_type=\'credit\' THEN amount_poisha ELSE -amount_poisha END), 0) as bal FROM merchant_ledger WHERE merchant_id = ?',
    args: [String(merchant.id)],
  });
  const currentBalance = Number(balRow.rows[0]?.bal ?? 0);
  const newBalance = currentBalance + bdtAmount;

  const paymentId = newId();
  const ledgerId = newId();

  await db.batch([
    {
      sql: `INSERT INTO payments (id, invoice_id, merchant_id, tx_hash, payer_wallet_address, amount_usdc_units, amount_bdt_poisha, block_number, block_timestamp, confirmations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [paymentId, invoice_id, String(merchant.id), tx_hash, payer_wallet_address, Number(invoice.amount_usdc_units), bdtAmount, Number(result.blockNumber ?? 0), result.blockTimestamp ? new Date(Number(result.blockTimestamp) * 1000).toISOString() : null, result.confirmations ?? 0],
    },
    {
      sql: `UPDATE invoices SET status='paid', paid_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), customer_wallet_address=?, payment_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      args: [payer_wallet_address, paymentId, invoice_id],
    },
    {
      sql: `INSERT INTO merchant_ledger (id, merchant_id, entry_type, amount_poisha, balance_after, payment_id, description) VALUES (?, ?, 'credit', ?, ?, ?, ?)`,
      args: [ledgerId, String(merchant.id), bdtAmount, newBalance, paymentId, `Payment for invoice ${invoice_id.slice(0, 8)}`],
    },
  ]);

  res.json({ success: true, data: { payment_id: paymentId, amount_bdt_poisha: bdtAmount, new_balance: newBalance } });
});

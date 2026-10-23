import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withPublic } from '../../../lib/middleware';
import { getDb } from '../../../lib/db';
import { signInvoiceAuthorization } from '../../../lib/signer';
import { uuidToBytes32 } from '../../../lib/verifier';

export default withPublic(async (req: VercelRequest, res: VercelResponse) => {
  const invoiceId = req.query?.id as string;
  const db = getDb();

  if (req.method === 'GET') {
    const invoiceRow = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [invoiceId] });
    const invoice = invoiceRow.rows[0];
    if (!invoice) { res.status(404).json({ success: false, error: 'Invoice not found' }); return; }
    const merchantRow = await db.execute({ sql: 'SELECT id, shop_name, slug, contact_email FROM merchants WHERE id = ?', args: [String(invoice.merchant_id)] });
    const merchant = merchantRow.rows[0];
    res.json({ success: true, data: { invoice, merchant } });
    return;
  }

  // POST → sign authorization for checkout
  if (req.method === 'POST') {
    const invoiceRow = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [invoiceId] });
    const invoice = invoiceRow.rows[0];
    if (!invoice) { res.status(404).json({ success: false, error: 'Invoice not found' }); return; }
    if (String(invoice.status) !== 'pending') { res.status(409).json({ success: false, error: 'Invoice not payable' }); return; }
    if (new Date(String(invoice.expires_at)) < new Date()) { res.status(410).json({ success: false, error: 'Invoice expired' }); return; }

    const contractAddress = process.env.VITE_GATEWAY_CONTRACT_ADDRESS as `0x${string}`;
    if (!contractAddress) { res.status(500).json({ success: false, error: 'Gateway contract not configured' }); return; }

    const authExpiry = Math.floor(new Date(String(invoice.auth_expires_at)).getTime() / 1000);
    const nonce = `0x${String(invoice.auth_nonce).padEnd(64, '0')}` as `0x${string}`;

    const signed = await signInvoiceAuthorization(
      contractAddress,
      uuidToBytes32(invoiceId),
      uuidToBytes32(String(invoice.merchant_id)),
      BigInt(Number(invoice.amount_usdc_units)),
      BigInt(authExpiry),
      nonce,
    );

    res.json({ success: true, data: signed });
    return;
  }

  res.status(405).json({ success: false, error: 'Method not allowed' });
});

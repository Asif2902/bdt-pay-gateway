import type { VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getDb, newId } from '../../lib/db';

const createSchema = z.object({
  shop_name: z.string().min(1).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers, hyphens only'),
  business_description: z.string().max(500).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(20).optional(),
  website_url: z.string().url().optional().or(z.literal('')),
});

const updateSchema = createSchema.partial().extend({
  payout_method: z.enum(['bkash', 'nagad', 'bank_transfer', 'other']).optional(),
  payout_account_name: z.string().max(100).optional(),
  payout_account_number: z.string().max(50).optional(),
  payout_bank_name: z.string().max(100).optional(),
  payout_bank_branch: z.string().max(100).optional(),
  payout_routing_number: z.string().max(50).optional(),
  custom_rate_poisha_per_usdc: z.number().int().positive().optional().nullable(),
});

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  const db = getDb();

  if (req.method === 'GET') {
    const row = await db.execute({ sql: 'SELECT * FROM merchants WHERE user_id = ?', args: [req.userId] });
    res.json({ success: true, data: row.rows[0] ?? null });
    return;
  }

  if (req.method === 'POST') {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    const d = parsed.data;
    // Check slug uniqueness
    const existing = await db.execute({ sql: 'SELECT id FROM merchants WHERE slug = ?', args: [d.slug] });
    if (existing.rows.length > 0) { res.status(409).json({ success: false, error: 'Slug already taken' }); return; }
    // Check not already registered
    const alreadyMerchant = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
    if (alreadyMerchant.rows.length > 0) { res.status(409).json({ success: false, error: 'Already registered as merchant' }); return; }
    const id = newId();
    await db.execute({
      sql: `INSERT INTO merchants (id, user_id, shop_name, slug, business_description, contact_email, contact_phone, website_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, req.userId, d.shop_name, d.slug, d.business_description ?? null, d.contact_email ?? null, d.contact_phone ?? null, d.website_url ?? null],
    });
    const created = await db.execute({ sql: 'SELECT * FROM merchants WHERE id = ?', args: [id] });
    res.status(201).json({ success: true, data: created.rows[0] });
    return;
  }

  if (req.method === 'PUT') {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
    const d = parsed.data;
    const merchant = await db.execute({ sql: 'SELECT id FROM merchants WHERE user_id = ?', args: [req.userId] });
    if (!merchant.rows[0]) { res.status(404).json({ success: false, error: 'Merchant not found' }); return; }
    const merchantId = String(merchant.rows[0].id);
    const sets: string[] = [];
    const args: unknown[] = [];
    const fields = ['shop_name', 'slug', 'business_description', 'contact_email', 'contact_phone', 'website_url', 'payout_method', 'payout_account_name', 'payout_account_number', 'payout_bank_name', 'payout_bank_branch', 'payout_routing_number', 'custom_rate_poisha_per_usdc'] as const;
    for (const f of fields) {
      if (f in d && d[f] !== undefined) { sets.push(`${f} = ?`); args.push(d[f] ?? null); }
    }
    if (sets.length > 0) {
      sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
      args.push(merchantId);
      await db.execute({ sql: `UPDATE merchants SET ${sets.join(', ')} WHERE id = ?`, args: args as import('@libsql/client').InArgs });
    }
    const updated = await db.execute({ sql: 'SELECT * FROM merchants WHERE id = ?', args: [merchantId] });
    res.json({ success: true, data: updated.rows[0] });
    return;
  }

  res.status(405).json({ success: false, error: 'Method not allowed' });
});

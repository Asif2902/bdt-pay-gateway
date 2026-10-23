/**
 * Public routes — no authentication required.
 * Used by the customer checkout page.
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../index';
import { signInvoiceAuthorization } from '../lib/signer';

export const publicRouter = Router();

// GET /api/public/merchants/:slug — merchant public info for checkout
publicRouter.get('/merchants/:slug', async (req, res, next) => {
  try {
    const slug = req.params.slug.toLowerCase();

    const { data, error } = await supabaseAdmin
      .from('merchants')
      .select(
        'id, shop_name, slug, business_description, logo_url, contact_email, website_url, is_active, is_suspended',
      )
      .eq('slug', slug)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    if (!data.is_active || data.is_suspended) {
      res.status(403).json({ success: false, error: 'This merchant is not accepting payments' });
      return;
    }

    // Never expose payout details on public endpoint
    const { is_suspended: _s, ...publicData } = data;
    res.json({ success: true, data: publicData });
  } catch (e) {
    next(e);
  }
});

// GET /api/public/invoices/:id — invoice info for checkout page
publicRouter.get('/invoices/:id', async (req, res, next) => {
  try {
    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select(
        'id, merchant_id, amount_bdt_poisha, rate_poisha_per_usdc, amount_usdc_units, ' +
        'customer_reference, description, status, expires_at, paid_at',
      )
      .eq('id', req.params.id)
      .single();

    if (error || !invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    // Auto-expire if past expiry
    if (invoice.status === 'pending' && new Date(invoice.expires_at) < new Date()) {
      await supabaseAdmin
        .from('invoices')
        .update({ status: 'expired' })
        .eq('id', invoice.id);
      invoice.status = 'expired';
    }

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id, shop_name, slug, logo_url, is_active, is_suspended')
      .eq('id', invoice.merchant_id)
      .single();

    res.json({
      success: true,
      data: {
        invoice,
        merchant: merchant
          ? { id: merchant.id, shop_name: merchant.shop_name, slug: merchant.slug, logo_url: merchant.logo_url }
          : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/public/invoices/:id/authorize — get signed authorization for on-chain payment
const authorizeSchema = z.object({
  payer_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid wallet address'),
});

publicRouter.post('/invoices/:id/authorize', async (req, res, next) => {
  try {
    const parsed = authorizeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    if (invoice.status !== 'pending') {
      res.status(409).json({ success: false, error: `Invoice is ${invoice.status}` });
      return;
    }

    if (new Date(invoice.expires_at) < new Date()) {
      await supabaseAdmin.from('invoices').update({ status: 'expired' }).eq('id', invoice.id);
      res.status(410).json({ success: false, error: 'Invoice has expired' });
      return;
    }

    const contractAddress = process.env.VITE_GATEWAY_CONTRACT_ADDRESS as `0x${string}`;
    if (!contractAddress) {
      res.status(503).json({ success: false, error: 'Gateway contract not configured' });
      return;
    }

    // Generate a fresh nonce for this authorization (32 bytes)
    const nonce = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;

    // Auth expires in 15 minutes from now
    const expirySeconds = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);

    // Convert UUIDs to bytes32
    const invoiceIdBytes32 = uuidToBytes32(invoice.id);
    const merchantIdBytes32 = uuidToBytes32(invoice.merchant_id);

    const auth = await signInvoiceAuthorization(
      contractAddress,
      invoiceIdBytes32,
      merchantIdBytes32,
      BigInt(invoice.amount_usdc_units),
      expirySeconds,
      nonce,
    );

    res.json({
      success: true,
      data: {
        invoiceId: auth.invoiceId,
        merchantId: auth.merchantId,
        amountUsdc: auth.amountUsdc.toString(),
        expiry: auth.expiry.toString(),
        nonce: auth.nonce,
        signature: auth.signature,
        contractAddress,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/public/rate — current exchange rate
publicRouter.get('/rate', async (_req, res, next) => {
  try {
    const { data } = await supabaseAdmin
      .from('system_config')
      .select('value')
      .eq('key', 'default_rate_poisha_per_usdc')
      .single();

    res.json({
      success: true,
      data: {
        rate_poisha_per_usdc: parseInt(data?.value ?? '12500', 10),
        display: `৳${parseInt(data?.value ?? '12500', 10) / 100} per USDC`,
      },
    });
  } catch (e) {
    next(e);
  }
});

function uuidToBytes32(uuid: string): `0x${string}` {
  const hex = uuid.replace(/-/g, '');
  return `0x${hex.padEnd(64, '0')}` as `0x${string}`;
}

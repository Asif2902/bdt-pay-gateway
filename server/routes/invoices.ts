import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '../index';
import { type AuthenticatedRequest } from '../middleware/auth';
import { calcUsdcUnitsServer } from '../lib/math';
import type { CreateInvoiceRequest } from '../../src/types';

export const invoiceRouter = Router();

const PAGE_SIZE = 20;

const createInvoiceSchema = z.object({
  amount_bdt_poisha: z
    .number()
    .int()
    .min(100, 'Minimum 1 BDT (100 poisha)')
    .max(10_000_000, 'Maximum 100,000 BDT'),
  customer_reference: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
});

// GET /api/invoices — list own invoices
invoiceRouter.get('/', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10));
    const status = req.query.status as string | undefined;

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.json({ success: true, data: { invoices: [], total: 0 } });
      return;
    }

    let q = supabaseAdmin
      .from('invoices')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchant.id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (status) q = q.eq('status', status);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({ success: true, data: { invoices: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

// GET /api/invoices/:id
invoiceRouter.get('/:id', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('invoices')
      .select('*')
      .eq('id', req.params.id)
      .eq('merchant_id', merchant.id)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// POST /api/invoices — create invoice
invoiceRouter.post('/', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }
    const body = parsed.data as CreateInvoiceRequest;

    // Get merchant + rate
    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id, is_suspended, custom_rate_poisha_per_usdc')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.status(404).json({ success: false, error: 'Complete merchant registration first' });
      return;
    }

    if (merchant.is_suspended) {
      res.status(403).json({ success: false, error: 'Account is suspended' });
      return;
    }

    // Get effective rate
    let ratePoishaPer1Usdc: number;
    if (merchant.custom_rate_poisha_per_usdc) {
      ratePoishaPer1Usdc = merchant.custom_rate_poisha_per_usdc;
    } else {
      const { data: cfg } = await supabaseAdmin
        .from('system_config')
        .select('value')
        .eq('key', 'default_rate_poisha_per_usdc')
        .single();
      ratePoishaPer1Usdc = parseInt(cfg?.value ?? '12500', 10);
    }

    // Calculate USDC units using integer arithmetic (ceiling division)
    const amountUsdcUnits = calcUsdcUnitsServer(body.amount_bdt_poisha, ratePoishaPer1Usdc);

    // Generate nonce (32 bytes random)
    const nonce = randomBytes(32);

    // Expiry times
    const { data: cfg2 } = await supabaseAdmin
      .from('system_config')
      .select('value')
      .eq('key', 'invoice_expiry_minutes')
      .single();
    const expiryMinutes = parseInt(cfg2?.value ?? '30', 10);

    const { data: cfg3 } = await supabaseAdmin
      .from('system_config')
      .select('value')
      .eq('key', 'invoice_auth_expiry_minutes')
      .single();
    const authExpiryMinutes = parseInt(cfg3?.value ?? '15', 10);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);
    const authExpiresAt = new Date(now.getTime() + authExpiryMinutes * 60 * 1000);

    const { data: invoice, error } = await supabaseAdmin
      .from('invoices')
      .insert({
        merchant_id: merchant.id,
        amount_bdt_poisha: body.amount_bdt_poisha,
        rate_poisha_per_usdc: ratePoishaPer1Usdc,
        amount_usdc_units: amountUsdcUnits,
        customer_reference: body.customer_reference,
        description: body.description,
        expires_at: expiresAt.toISOString(),
        auth_nonce: `\\x${nonce.toString('hex')}`,
        auth_expires_at: authExpiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'invoice_created',
      target_type: 'invoice',
      target_id: invoice.id,
      details: {
        amount_bdt_poisha: body.amount_bdt_poisha,
        amount_usdc_units: amountUsdcUnits,
        rate: ratePoishaPer1Usdc,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        invoice,
        checkout_url: `/pay/${invoice.id}`,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/invoices/:id/cancel
invoiceRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const { data: invoice, error: fetchErr } = await supabaseAdmin
      .from('invoices')
      .select('id, status')
      .eq('id', req.params.id)
      .eq('merchant_id', merchant.id)
      .single();

    if (fetchErr || !invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    if (invoice.status !== 'pending') {
      res.status(409).json({ success: false, error: `Cannot cancel ${invoice.status} invoice` });
      return;
    }

    const { error } = await supabaseAdmin
      .from('invoices')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', invoice.id);

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'invoice_cancelled',
      target_type: 'invoice',
      target_id: invoice.id,
    });

    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

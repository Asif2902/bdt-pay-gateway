import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../index';
import { type AuthenticatedRequest } from '../middleware/auth';
import type { CreateMerchantRequest, UpdateMerchantRequest, UpdatePayoutDetailsRequest } from '../../src/types';

export const merchantRouter = Router();

const SLUG_REGEX = /^[a-z0-9-]{3,50}$/;

const createMerchantSchema = z.object({
  shop_name: z.string().min(2).max(100),
  slug: z.string().regex(SLUG_REGEX, 'Slug must be 3-50 lowercase letters, numbers, or hyphens'),
  business_description: z.string().max(500).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(30).optional(),
  website_url: z.string().url().optional(),
});

const updateMerchantSchema = z.object({
  shop_name: z.string().min(2).max(100).optional(),
  business_description: z.string().max(500).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(30).optional(),
  website_url: z.string().url().optional(),
  logo_url: z.string().url().optional(),
});

const updatePayoutSchema = z.object({
  payout_method: z.enum(['bkash', 'nagad', 'bank_transfer', 'other']),
  payout_account_name: z.string().min(2).max(100),
  payout_account_number: z.string().min(5).max(50),
  payout_bank_name: z.string().max(100).optional(),
  payout_bank_branch: z.string().max(100).optional(),
  payout_routing_number: z.string().max(50).optional(),
});

// GET /api/merchants/me — get own merchant record
merchantRouter.get('/me', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const { data, error } = await supabaseAdmin
      .from('merchants')
      .select('*')
      .eq('profile_id', authed.userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No merchant record yet
        res.json({ success: true, data: null });
        return;
      }
      throw error;
    }

    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// POST /api/merchants — create merchant
merchantRouter.post('/', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const parsed = createMerchantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }
    const body = parsed.data as CreateMerchantRequest;

    // Check not already a merchant
    const { data: existing } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (existing) {
      res.status(409).json({ success: false, error: 'Merchant record already exists' });
      return;
    }

    // Check slug not taken
    const { data: slugConflict } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('slug', body.slug)
      .single();

    if (slugConflict) {
      res.status(409).json({ success: false, error: 'Slug is already taken' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('merchants')
      .insert({ ...body, profile_id: authed.userId })
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'merchant_created',
      target_type: 'merchant',
      target_id: data.id,
    });

    res.status(201).json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/merchants/me — update merchant info
merchantRouter.patch('/me', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const parsed = updateMerchantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    const body = parsed.data as UpdateMerchantRequest;
    const { data, error } = await supabaseAdmin
      .from('merchants')
      .update(body)
      .eq('id', merchant.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// PUT /api/merchants/me/payout-details — update payout details (logged access)
merchantRouter.put('/me/payout-details', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const parsed = updatePayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    const body = parsed.data as UpdatePayoutDetailsRequest;
    const { error } = await supabaseAdmin
      .from('merchants')
      .update({
        payout_method: body.payout_method,
        payout_account_name: body.payout_account_name,
        payout_account_number: body.payout_account_number,
        payout_bank_name: body.payout_bank_name,
        payout_bank_branch: body.payout_bank_branch,
        payout_routing_number: body.payout_routing_number,
      })
      .eq('id', merchant.id);

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'payout_details_viewed',
      target_type: 'merchant',
      target_id: merchant.id,
      details: { action: 'payout_details_updated' },
      ip_address: req.ip,
    });

    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

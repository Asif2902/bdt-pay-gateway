import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../index';
import { type AuthenticatedRequest } from '../middleware/auth';

export const payoutRouter = Router();

const PAGE_SIZE = 20;

const createPayoutSchema = z.object({
  amount_bdt_poisha: z.number().int().min(100, 'Minimum payout is 1 BDT (100 poisha)'),
});

// GET /api/payouts
payoutRouter.get('/', async (req, res, next) => {
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
      res.json({ success: true, data: { payouts: [], total: 0 } });
      return;
    }

    let q = supabaseAdmin
      .from('payouts')
      // Mask account number — expose only last 4 digits
      .select(
        'id, merchant_id, amount_bdt_poisha, payout_method, payout_account_name, status, ' +
        'initiated_at, external_reference, external_timestamp, confirmed_at, ' +
        'failed_reason, created_at, updated_at',
        { count: 'exact' },
      )
      .eq('merchant_id', merchant.id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (status) q = q.eq('status', status);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({ success: true, data: { payouts: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

// POST /api/payouts — request a payout
payoutRouter.post('/', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const parsed = createPayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select(
        'id, is_suspended, payout_method, payout_account_name, payout_account_number, payout_bank_name',
      )
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    if (merchant.is_suspended) {
      res.status(403).json({ success: false, error: 'Account is suspended' });
      return;
    }

    if (!merchant.payout_method || !merchant.payout_account_name || !merchant.payout_account_number) {
      res.status(400).json({ success: false, error: 'Configure payout details first' });
      return;
    }

    // Check available balance
    const { data: balance } = await supabaseAdmin.rpc('get_merchant_balance', {
      p_merchant_id: merchant.id,
    });

    const requestedAmount = parsed.data.amount_bdt_poisha;
    if ((balance ?? 0) < requestedAmount) {
      res.status(422).json({
        success: false,
        error: `Insufficient balance: available ${balance ?? 0} poisha, requested ${requestedAmount} poisha`,
      });
      return;
    }

    // Check no pending payout already
    const { data: pendingPayout } = await supabaseAdmin
      .from('payouts')
      .select('id')
      .eq('merchant_id', merchant.id)
      .in('status', ['pending', 'processing'])
      .maybeSingle();

    if (pendingPayout) {
      res.status(409).json({
        success: false,
        error: 'A payout is already pending. Wait for it to complete before requesting another.',
      });
      return;
    }

    const { data: payout, error } = await supabaseAdmin
      .from('payouts')
      .insert({
        merchant_id: merchant.id,
        amount_bdt_poisha: requestedAmount,
        payout_method: merchant.payout_method,
        payout_account_name: merchant.payout_account_name,
        payout_account_number: merchant.payout_account_number,
        payout_bank_name: merchant.payout_bank_name,
      })
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'payout_created',
      target_type: 'payout',
      target_id: payout.id,
      details: { amount_bdt_poisha: requestedAmount },
    });

    // Return masked payout (no full account number)
    const safePayout = { ...payout, payout_account_number: undefined };
    res.status(201).json({ success: true, data: safePayout });
  } catch (e) {
    next(e);
  }
});

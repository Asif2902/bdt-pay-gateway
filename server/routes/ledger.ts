import { Router } from 'express';
import { supabaseAdmin } from '../index';
import { type AuthenticatedRequest } from '../middleware/auth';

export const ledgerRouter = Router();

const PAGE_SIZE = 20;

// GET /api/ledger/balance
ledgerRouter.get('/balance', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.json({ success: true, data: { balance_poisha: 0 } });
      return;
    }

    const { data, error } = await supabaseAdmin.rpc('get_merchant_balance', {
      p_merchant_id: merchant.id,
    });

    if (error) throw error;
    res.json({ success: true, data: { balance_poisha: data ?? 0 } });
  } catch (e) {
    next(e);
  }
});

// GET /api/ledger — list ledger entries
ledgerRouter.get('/', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10));

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.json({ success: true, data: { entries: [], total: 0 } });
      return;
    }

    const { data, count, error } = await supabaseAdmin
      .from('merchant_ledger')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchant.id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw error;
    res.json({ success: true, data: { entries: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

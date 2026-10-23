import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../index';
import { type AuthenticatedRequest, requireRole } from '../middleware/auth';

export const adminRouter = Router();

// All admin routes require admin or operator role
adminRouter.use(requireRole('admin', 'operator'));

const PAGE_SIZE = 20;

// ============================================================
// MERCHANTS
// ============================================================

adminRouter.get('/merchants', async (req, res, next) => {
  try {
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10));
    const search = String(req.query.search ?? '');

    let q = supabaseAdmin
      .from('merchants')
      .select('*, profiles!inner(id, email, full_name, role, is_active)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (search) {
      q = q.or(`shop_name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({ success: true, data: { merchants: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/merchants/:id/suspend', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);

    const { error } = await supabaseAdmin
      .from('merchants')
      .update({ is_suspended: true, suspension_reason: reason })
      .eq('id', req.params.id);

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'merchant_suspended',
      target_type: 'merchant',
      target_id: req.params.id,
      details: { reason },
      ip_address: req.ip,
    });

    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/merchants/:id/activate', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;

    const { error } = await supabaseAdmin
      .from('merchants')
      .update({ is_suspended: false, suspension_reason: null })
      .eq('id', req.params.id);

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'merchant_activated',
      target_type: 'merchant',
      target_id: req.params.id,
      ip_address: req.ip,
    });

    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// PAYMENTS
// ============================================================

adminRouter.get('/payments', async (req, res, next) => {
  try {
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10));
    const search = String(req.query.search ?? '');

    let q = supabaseAdmin
      .from('payments')
      .select('*, invoices(customer_reference, description), merchants(shop_name, slug)', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (search) {
      q = q.or(
        `tx_hash.ilike.%${search}%,payer_wallet_address.ilike.%${search}%`,
      );
    }

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({ success: true, data: { payments: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// PAYOUTS
// ============================================================

adminRouter.get('/payouts/pending', async (req, res, next) => {
  try {
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10));

    const { data, count, error } = await supabaseAdmin
      .from('payouts')
      .select(
        '*, merchants(shop_name, slug, profile_id, payout_account_number, payout_bank_name), profiles(email)',
        { count: 'exact' },
      )
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw error;
    res.json({ success: true, data: { payouts: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/payouts/:id/initiate — mark as processing (operator)
adminRouter.post('/payouts/:id/initiate', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;

    const { data: payout, error: fetchErr } = await supabaseAdmin
      .from('payouts')
      .select('id, status, merchant_id, amount_bdt_poisha')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !payout) {
      res.status(404).json({ success: false, error: 'Payout not found' });
      return;
    }

    if (payout.status !== 'pending') {
      res.status(409).json({ success: false, error: `Payout is already ${payout.status}` });
      return;
    }

    const { error } = await supabaseAdmin
      .from('payouts')
      .update({
        status: 'processing',
        initiated_by: authed.userId,
        initiated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'payout_created',
      target_type: 'payout',
      target_id: req.params.id,
      details: { step: 'processing_started' },
      ip_address: req.ip,
    });

    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

const confirmPayoutSchema = z.object({
  external_reference: z.string().min(1),
  external_timestamp: z.string().datetime(),
  external_note: z.string().max(500).optional(),
});

// POST /api/admin/payouts/:id/confirm — record external transfer and confirm
// Only admin role (not operator) can confirm — merchant cannot confirm their own payout
adminRouter.post('/payouts/:id/confirm', requireRole('admin'), async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const parsed = confirmPayoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }

    const { data: payout, error: fetchErr } = await supabaseAdmin
      .from('payouts')
      .select('id, status, merchant_id, amount_bdt_poisha')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !payout) {
      res.status(404).json({ success: false, error: 'Payout not found' });
      return;
    }

    if (payout.status === 'completed') {
      res.status(409).json({ success: false, error: 'Payout already confirmed' });
      return;
    }

    if (!['pending', 'processing'].includes(payout.status)) {
      res.status(409).json({ success: false, error: `Cannot confirm ${payout.status} payout` });
      return;
    }

    // Atomic: debit ledger + mark payout completed
    const { data: balance } = await supabaseAdmin.rpc('get_merchant_balance', {
      p_merchant_id: payout.merchant_id,
    });

    if ((balance ?? 0) < payout.amount_bdt_poisha) {
      res.status(422).json({
        success: false,
        error: 'Merchant balance is insufficient to complete this payout',
      });
      return;
    }

    // Insert ledger debit
    const { data: currentBalance } = await supabaseAdmin.rpc('get_merchant_balance', {
      p_merchant_id: payout.merchant_id,
    });

    const { data: ledgerEntry, error: ledgerErr } = await supabaseAdmin
      .from('merchant_ledger')
      .insert({
        merchant_id: payout.merchant_id,
        entry_type: 'debit',
        amount_poisha: payout.amount_bdt_poisha,
        balance_after: (currentBalance ?? 0) - payout.amount_bdt_poisha,
        payout_id: payout.id,
        description: `BDT payout confirmed: ref ${parsed.data.external_reference}`,
        created_by: `admin:${authed.userId}`,
      })
      .select()
      .single();

    if (ledgerErr) throw ledgerErr;

    // Confirm payout
    const { error: payoutErr } = await supabaseAdmin
      .from('payouts')
      .update({
        status: 'completed',
        confirmed_by: authed.userId,
        confirmed_at: new Date().toISOString(),
        external_reference: parsed.data.external_reference,
        external_timestamp: parsed.data.external_timestamp,
        external_note: parsed.data.external_note,
        ledger_entry_id: ledgerEntry.id,
      })
      .eq('id', req.params.id);

    if (payoutErr) throw payoutErr;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'payout_confirmed',
      target_type: 'payout',
      target_id: req.params.id,
      details: {
        external_reference: parsed.data.external_reference,
        amount_bdt_poisha: payout.amount_bdt_poisha,
      },
      ip_address: req.ip,
    });

    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/payouts/:id/cancel
adminRouter.post('/payouts/:id/cancel', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);

    const { data: payout, error: fetchErr } = await supabaseAdmin
      .from('payouts')
      .select('id, status')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !payout) {
      res.status(404).json({ success: false, error: 'Payout not found' });
      return;
    }

    if (payout.status === 'completed') {
      res.status(409).json({ success: false, error: 'Cannot cancel completed payout' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('payouts')
      .update({
        status: 'cancelled',
        cancelled_by: authed.userId,
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
      })
      .eq('id', req.params.id);

    if (error) throw error;

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'payout_cancelled',
      target_type: 'payout',
      target_id: req.params.id,
      details: { reason },
      ip_address: req.ip,
    });

    res.json({ success: true, data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

// ============================================================
// AUDIT LOGS
// ============================================================

adminRouter.get('/audit-logs', requireRole('admin'), async (req, res, next) => {
  try {
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10));
    const action = req.query.action as string | undefined;

    let q = supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (action) q = q.eq('action', action);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({ success: true, data: { logs: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

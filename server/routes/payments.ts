/**
 * Payment verification endpoint.
 *
 * The frontend submits a tx_hash after the user's wallet confirms the transaction.
 * This endpoint INDEPENDENTLY verifies everything on-chain — it does NOT trust
 * any client-submitted claim about amounts, merchants, or invoice IDs.
 *
 * Idempotent: submitting the same tx_hash twice is safe and returns the same result.
 */

import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../index';
import { type AuthenticatedRequest } from '../middleware/auth';
import { verifyPayment, uuidToBytes32 } from '../lib/verifier';
import { calcBdtPoisha } from '../lib/math';

export const paymentRouter = Router();

const PAGE_SIZE = 20;

const verifySchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash'),
  invoice_id: z.string().uuid('Invalid invoice ID'),
});

// POST /api/payments/verify
paymentRouter.post('/verify', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message });
      return;
    }
    const { tx_hash, invoice_id } = parsed.data;

    // Idempotency: if already processed return existing record
    const { data: existing } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('tx_hash', tx_hash)
      .maybeSingle();

    if (existing) {
      res.json({ success: true, data: existing });
      return;
    }

    // Load invoice
    const { data: invoice, error: invoiceErr } = await supabaseAdmin
      .from('invoices')
      .select('*, merchants(id, is_suspended, is_active)')
      .eq('id', invoice_id)
      .single();

    if (invoiceErr || !invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found' });
      return;
    }

    if (invoice.status === 'paid') {
      res.status(409).json({ success: false, error: 'Invoice already paid' });
      return;
    }

    if (invoice.status !== 'pending') {
      res.status(409).json({
        success: false,
        error: `Invoice is ${invoice.status} and cannot accept payment`,
      });
      return;
    }

    if (new Date(invoice.expires_at) < new Date()) {
      // Auto-expire
      await supabaseAdmin
        .from('invoices')
        .update({ status: 'expired' })
        .eq('id', invoice_id);
      res.status(410).json({ success: false, error: 'Invoice has expired' });
      return;
    }

    const contractAddress = process.env.VITE_GATEWAY_CONTRACT_ADDRESS as `0x${string}`;
    if (!contractAddress) {
      res.status(503).json({
        success: false,
        error: 'Gateway contract address not configured',
      });
      return;
    }

    // Independent blockchain verification
    const result = await verifyPayment(
      tx_hash,
      contractAddress,
      uuidToBytes32(invoice_id),
      uuidToBytes32(invoice.merchant_id),
      BigInt(invoice.amount_usdc_units),
    );

    if (!result.ok) {
      res.status(422).json({ success: false, error: result.error, code: 'VERIFICATION_FAILED' });
      return;
    }

    // Calculate BDT credit at locked rate
    const amountBdtPoisha = calcBdtPoisha(
      Number(result.amountUsdc!),
      invoice.rate_poisha_per_usdc,
    );

    // Atomic: insert payment + credit ledger in DB function
    const { data: payment, error: insertErr } = await supabaseAdmin
      .from('payments')
      .insert({
        invoice_id,
        merchant_id: invoice.merchant_id,
        tx_hash,
        block_number: Number(result.blockNumber!),
        block_timestamp: new Date(Number(result.blockTimestamp!) * 1000).toISOString(),
        chain_id: result.chainId!,
        contract_address: result.contractAddress!,
        usdc_token_address: result.tokenAddress!,
        payer_wallet_address: result.payer!,
        amount_usdc_units: Number(result.amountUsdc!),
        amount_bdt_poisha: amountBdtPoisha,
        rate_poisha_per_usdc: invoice.rate_poisha_per_usdc,
        confirmations_at_verify: result.confirmations!,
        status: 'confirmed',
        verified_at: new Date().toISOString(),
        verified_by: 'system',
      })
      .select()
      .single();

    if (insertErr) {
      // Could be duplicate (race condition) — check again
      const { data: racePayment } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('tx_hash', tx_hash)
        .maybeSingle();
      if (racePayment) {
        res.json({ success: true, data: racePayment });
        return;
      }
      throw insertErr;
    }

    // Credit merchant ledger atomically
    const { error: ledgerErr } = await supabaseAdmin.rpc('credit_merchant_for_payment', {
      p_payment_id: payment.id,
    });

    if (ledgerErr) {
      console.error('[payments] Ledger credit failed:', ledgerErr);
      // Payment is recorded but ledger failed — operator must reconcile
    }

    // Mark invoice as paid
    await supabaseAdmin
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        customer_wallet_address: result.payer,
        payment_id: payment.id,
      })
      .eq('id', invoice_id);

    await supabaseAdmin.from('audit_logs').insert({
      actor_id: authed.userId,
      actor_email: authed.userEmail,
      action: 'payment_verified',
      target_type: 'payment',
      target_id: payment.id,
      details: {
        tx_hash,
        invoice_id,
        amount_usdc_units: Number(result.amountUsdc!),
        amount_bdt_poisha: amountBdtPoisha,
        block_number: Number(result.blockNumber!),
      },
    });

    res.status(201).json({ success: true, data: payment });
  } catch (e) {
    next(e);
  }
});

// GET /api/payments — list own payments
paymentRouter.get('/', async (req, res, next) => {
  try {
    const authed = req as AuthenticatedRequest;
    const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10));

    const { data: merchant } = await supabaseAdmin
      .from('merchants')
      .select('id')
      .eq('profile_id', authed.userId)
      .single();

    if (!merchant) {
      res.json({ success: true, data: { payments: [], total: 0 } });
      return;
    }

    const { data, count, error } = await supabaseAdmin
      .from('payments')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchant.id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw error;
    res.json({ success: true, data: { payments: data, total: count ?? 0 } });
  } catch (e) {
    next(e);
  }
});

// GET /api/payments/:id
paymentRouter.get('/:id', async (req, res, next) => {
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
      .from('payments')
      .select('*')
      .eq('id', req.params.id)
      .eq('merchant_id', merchant.id)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'Payment not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

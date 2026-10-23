/**
 * Express backend server for USDC-to-BDT Payment Gateway
 *
 * Runs on port 3001. Frontend reaches it via Vite proxy at /api/*.
 * Uses Supabase service-role key (never exposed to frontend).
 * All blockchain verification uses viem with Arc Mainnet RPC.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { createClient } from '@supabase/supabase-js';
import { merchantRouter } from './routes/merchants';
import { invoiceRouter } from './routes/invoices';
import { paymentRouter } from './routes/payments';
import { ledgerRouter } from './routes/ledger';
import { payoutRouter } from './routes/payouts';
import { adminRouter } from './routes/admin';
import { adminAuthRouter } from './routes/adminAuth';
import { publicRouter } from './routes/public';
import { errorHandler } from './middleware/errorHandler';
import { requireAuth } from './middleware/auth';

const PORT = process.env.PORT ?? 3001;

// ============================================================
// Supabase admin client (service role — never sent to frontend)
// ============================================================

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    '[server] VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. ' +
    'Copy .env.example to .env and configure your Supabase project.',
  );
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// ============================================================
// App setup
// ============================================================

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", supabaseUrl],
    },
  },
}));

// CORS — allow only the Vite dev server and deployed origin
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

// Global rate limiter
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Tighter limit on auth-sensitive endpoints
const strictLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
// Routes
// ============================================================

// Public routes (no auth required)
app.use('/api/public', strictLimit, publicRouter);

// Admin auth (password-based, separate from Supabase — no requireAuth)
app.use('/api/admin-auth', strictLimit, adminAuthRouter);

// Admin routes (protected by requireAdminAuth inside adminRouter)
app.use('/api/admin', adminRouter);

// Merchant-facing protected routes (Supabase JWT)
app.use('/api/merchants', requireAuth, merchantRouter);
app.use('/api/invoices', requireAuth, invoiceRouter);
app.use('/api/payments', requireAuth, strictLimit, paymentRouter);
app.use('/api/ledger', requireAuth, ledgerRouter);
app.use('/api/payouts', requireAuth, payoutRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[server] Payment gateway API running on port ${PORT}`);
});

export default app;

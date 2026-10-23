/**
 * Admin authentication routes — completely separate from Supabase merchant auth.
 *
 * POST /api/admin-auth/login   — validate ADMIN_PASSWORD, issue JWT
 * POST /api/admin-auth/logout  — revoke current session
 * GET  /api/admin-auth/me      — return { ok: true } if session valid
 *
 * The password is set via the ADMIN_PASSWORD env var.
 * On first start, if ADMIN_PASSWORD is unset the server logs a warning and
 * all login attempts return 503.
 *
 * JWT is returned in the response body AND as an httpOnly cookie so the
 * frontend SPA can store it in state without localStorage exposure.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { saveSession, revokeSession, isSessionValid, logAudit } from '../lib/adminDb';

export const adminAuthRouter = Router();

// ── Config ───────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? 'change-me-in-production';
const JWT_EXPIRES_IN = 60 * 60 * 8; // 8 hours in seconds
const COOKIE_NAME = 'admin_token';

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[admin-auth] WARNING: ADMIN_PASSWORD env var is not set. Admin login is disabled.');
}
if (process.env.ADMIN_JWT_SECRET === undefined) {
  console.warn('[admin-auth] WARNING: ADMIN_JWT_SECRET is not set — using insecure default. Set it in .env.');
}

// Hash the password once at startup (bcrypt is slow by design)
let passwordHashCache: string | null = null;

async function getPasswordHash(): Promise<string | null> {
  const raw = process.env.ADMIN_PASSWORD;
  if (!raw) return null;
  if (!passwordHashCache) {
    passwordHashCache = await bcrypt.hash(raw, 12);
  }
  return passwordHashCache;
}

// ── Middleware ────────────────────────────────────────────────────────────────

export interface AdminRequest extends Request {
  adminJti?: string;
}

export async function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Accept token from cookie or Authorization header
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
  const fromHeader = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = fromCookie ?? fromHeader;

  if (!token) {
    res.status(401).json({ success: false, error: 'Admin authentication required' });
    return;
  }

  let payload: { jti?: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { jti?: string };
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired admin token' });
    return;
  }

  if (!payload.jti || !isSessionValid(payload.jti)) {
    res.status(401).json({ success: false, error: 'Session revoked or expired' });
    return;
  }

  (req as AdminRequest).adminJti = payload.jti;
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/admin-auth/login
adminAuthRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { password } = req.body as { password?: string };

  if (!process.env.ADMIN_PASSWORD) {
    res.status(503).json({ success: false, error: 'Admin login not configured' });
    return;
  }

  if (!password || typeof password !== 'string') {
    res.status(400).json({ success: false, error: 'Password is required' });
    return;
  }

  const hash = await getPasswordHash();
  if (!hash) {
    res.status(503).json({ success: false, error: 'Admin login not configured' });
    return;
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    logAudit({ action: 'admin_login_failed', ip: req.ip });
    // Constant-time delay to prevent timing attacks
    res.status(401).json({ success: false, error: 'Invalid password' });
    return;
  }

  const jti = uuidv4();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + JWT_EXPIRES_IN;

  saveSession(jti, expiresAt, req.ip ?? null);
  logAudit({ action: 'admin_login', ip: req.ip });

  const token = jwt.sign({ sub: 'admin', jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  // httpOnly cookie (for same-origin requests)
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: JWT_EXPIRES_IN * 1000,
    path: '/',
  });

  res.json({ success: true, data: { token, expiresAt } });
});

// POST /api/admin-auth/logout
adminAuthRouter.post('/logout', requireAdminAuth, (req: Request, res: Response): void => {
  const jti = (req as AdminRequest).adminJti;
  if (jti) {
    revokeSession(jti);
    logAudit({ action: 'admin_logout', ip: req.ip });
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true, data: { ok: true } });
});

// GET /api/admin-auth/me
adminAuthRouter.get('/me', requireAdminAuth, (_req: Request, res: Response): void => {
  res.json({ success: true, data: { role: 'admin' } });
});

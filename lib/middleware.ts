/**
 * Auth middleware helpers for Vercel API routes.
 * Extract + verify JWT from Authorization header.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyMerchantToken, verifyAdminToken, type MerchantTokenPayload } from './auth';
import { initDb } from './db';

export interface AuthedRequest extends VercelRequest {
  userId: string;
  userEmail: string;
  userRole: string;
}

/** Wrap a Vercel handler with merchant JWT auth. */
export function withAuth(
  handler: (req: AuthedRequest, res: VercelResponse) => Promise<void>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGINS ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    await initDb();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Missing authentication token' });
      return;
    }
    try {
      const payload: MerchantTokenPayload = await verifyMerchantToken(authHeader.slice(7));
      const authed = req as AuthedRequest;
      authed.userId = payload.userId;
      authed.userEmail = payload.email;
      authed.userRole = payload.role;
      await handler(authed, res);
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
  };
}

/** Wrap a Vercel handler with admin JWT auth. */
export function withAdmin(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGINS ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    await initDb();

    const authHeader = req.headers.authorization;
    const cookieToken = parseCookieToken(req.headers.cookie);
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (!token) {
      res.status(401).json({ success: false, error: 'Admin authentication required' });
      return;
    }
    try {
      await verifyAdminToken(token);
      await handler(req, res);
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired admin token' });
    }
  };
}

/** Wrap a public Vercel handler (no auth, just CORS + initDb). */
export function withPublic(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    await initDb();
    await handler(req, res);
  };
}

function parseCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

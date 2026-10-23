/**
 * Auth middleware helpers for Vercel API routes.
 * CORS and initDb are handled once by the catch-all dispatcher in api/[...route].ts.
 * These wrappers only verify JWTs and attach identity to the request.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyMerchantToken, verifyAdminToken, type MerchantTokenPayload } from './auth';

export interface AuthedRequest extends VercelRequest {
  userId: string;
  userEmail: string;
  userRole: string;
}

/** Wrap a handler with merchant JWT auth. */
export function withAuth(
  handler: (req: AuthedRequest, res: VercelResponse) => Promise<void>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
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

/** Wrap a handler with admin JWT auth. */
export function withAdmin(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
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

/**
 * withPublic — kept for compatibility but is now a no-op wrapper.
 * CORS and initDb are handled by the dispatcher; this just calls the handler.
 */
export function withPublic(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<void>,
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    await handler(req, res);
  };
}

function parseCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

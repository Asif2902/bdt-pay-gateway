/**
 * Authentication middleware — verifies Supabase JWT from Authorization header.
 * Attaches user + profile to req for downstream route use.
 */

import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../index';
import type { Profile } from '../../src/types';

export interface AuthenticatedRequest extends Request {
  userId: string;
  userEmail: string;
  profile: Profile;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing authentication token' });
    return;
  }

  const token = authHeader.slice(7);

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  // Load profile
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    res.status(401).json({ success: false, error: 'Profile not found' });
    return;
  }

  if (!profile.is_active) {
    res.status(403).json({ success: false, error: 'Account is deactivated' });
    return;
  }

  const authedReq = req as AuthenticatedRequest;
  authedReq.userId = user.id;
  authedReq.userEmail = user.email ?? '';
  authedReq.profile = profile as Profile;

  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authedReq = req as AuthenticatedRequest;
    if (!authedReq.profile || !roles.includes(authedReq.profile.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

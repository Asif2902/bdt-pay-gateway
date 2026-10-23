import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withPublic } from '../../lib/middleware';
import { verifyAdminPassword, signAdminToken, verifyAdminToken } from '../../lib/auth';
import { initDb } from '../../lib/db';

const loginSchema = z.object({ password: z.string().min(1) });

// POST /api/admin/auth  → login
// GET  /api/admin/auth  → verify (me)
// DELETE /api/admin/auth → logout

async function handler(req: VercelRequest, res: VercelResponse) {
  await initDb();

  if (req.method === 'POST') {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, error: 'Password required' }); return; }
    try {
      const ok = await verifyAdminPassword(parsed.data.password);
      if (!ok) { res.status(401).json({ success: false, error: 'Invalid password' }); return; }
      const { token } = await signAdminToken();
      res.setHeader('Set-Cookie', `admin_token=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800`);
      res.json({ success: true, data: { token } });
    } catch (e) {
      res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Login failed' });
    }
    return;
  }

  if (req.method === 'GET') {
    const authHeader = req.headers.authorization;
    const cookieToken = (req.headers.cookie ?? '').match(/admin_token=([^;]+)/)?.[1];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (cookieToken ? decodeURIComponent(cookieToken) : null);
    if (!token) { res.status(401).json({ success: false, error: 'Not authenticated' }); return; }
    try {
      await verifyAdminToken(token);
      res.json({ success: true, data: { role: 'admin' } });
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
    res.json({ success: true, data: { ok: true } });
    return;
  }

  res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withPublic(handler);

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withPublic } from '../../lib/middleware';
import { loginUser, signMerchantToken } from '../../lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default withPublic(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
  try {
    const user = await loginUser(parsed.data.email, parsed.data.password);
    if (!user.is_active) { res.status(403).json({ success: false, error: 'Account is deactivated' }); return; }
    const token = await signMerchantToken(user.id, user.email, user.role);
    res.json({ success: true, data: { token, user: { id: user.id, email: user.email, role: user.role } } });
  } catch (e) {
    res.status(401).json({ success: false, error: e instanceof Error ? e.message : 'Login failed' });
  }
});

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { withPublic } from '../../lib/middleware';
import { registerUser, signMerchantToken } from '../../lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().max(100).optional(),
});

export default withPublic(async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ success: false, error: parsed.error.issues[0]?.message }); return; }
  try {
    const user = await registerUser(parsed.data.email, parsed.data.password, parsed.data.full_name);
    const token = await signMerchantToken(user.id, user.email, user.role);
    res.status(201).json({ success: true, data: { token, user: { id: user.id, email: user.email, role: user.role } } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Registration failed';
    res.status(409).json({ success: false, error: msg });
  }
});

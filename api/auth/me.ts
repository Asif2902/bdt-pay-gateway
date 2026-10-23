import type { VercelResponse } from '@vercel/node';
import { withAuth, type AuthedRequest } from '../../lib/middleware';
import { getUserById } from '../../lib/auth';

export default withAuth(async (req: AuthedRequest, res: VercelResponse) => {
  if (req.method !== 'GET') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }
  const user = await getUserById(req.userId);
  if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }
  res.json({ success: true, data: { user } });
});

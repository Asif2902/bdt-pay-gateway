import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Store, ArrowRight, Info } from 'lucide-react';
import { merchantApi } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function OnboardingPage() {
  const { refreshMerchant } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    shop_name: '',
    slug: '',
    business_description: '',
    contact_email: '',
    website_url: '',
  });
  const [loading, setLoading] = useState(false);
  const [slugManual, setSlugManual] = useState(false);

  function handleShopNameChange(val: string) {
    const newSlug = slugManual ? form.slug : val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    setForm((f) => ({ ...f, shop_name: val, slug: newSlug }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.shop_name.trim() || !form.slug.trim()) return;
    setLoading(true);
    try {
      await merchantApi.create(form);
      await refreshMerchant();
      toast.success('Shop created!');
      void navigate('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create shop');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-slate-900 mb-4">
            <Store className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Space Grotesk, sans-serif', letterSpacing: '-0.02em' }}>
            Create your shop
          </h1>
          <p className="text-slate-500 mt-1">Set up your merchant profile to start accepting payments.</p>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Shop Name</label>
            <input
              type="text"
              value={form.shop_name}
              onChange={(e) => handleShopNameChange(e.target.value)}
              placeholder="My Amazing Shop"
              required
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Shop URL Slug
              <span className="ml-2 text-xs text-slate-400 font-normal">(your public checkout link)</span>
            </label>
            <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-slate-300">
              <span className="pl-4 pr-2 text-sm text-slate-400 whitespace-nowrap select-none">/pay/shop/</span>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => {
                  setSlugManual(true);
                  setForm((f) => ({
                    ...f,
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  }));
                }}
                placeholder="my-shop"
                pattern="[a-z0-9-]{3,50}"
                required
                className="flex-1 py-2.5 pr-4 text-slate-900 text-sm focus:outline-none bg-transparent"
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">3-50 characters, lowercase letters, numbers, and hyphens only.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Business Description <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={form.business_description}
              onChange={(e) => setForm((f) => ({ ...f, business_description: e.target.value }))}
              rows={3}
              placeholder="What does your shop sell?"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Contact Email <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
              placeholder="shop@example.com"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {/* Info banner */}
          <div className="flex gap-3 p-4 bg-blue-50 rounded-xl text-sm text-blue-700">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>
              After setup, configure your BDT payout method (bKash, Nagad, or bank transfer) in your dashboard settings.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-60 transition-colors"
          >
            {loading ? 'Creating...' : 'Create Shop'}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}

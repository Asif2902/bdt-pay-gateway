import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, useAuthProvider } from '@/hooks/useAuth';
import AuthPage from '@/pages/AuthPage';
import OnboardingPage from '@/pages/OnboardingPage';
import DashboardPage from '@/pages/DashboardPage';
import CheckoutPage from '@/pages/CheckoutPage';
import AdminPage from '@/pages/AdminPage';

function ProtectedRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const auth = useAuthProvider();
  if (auth.loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
      </div>
    );
  }
  if (!auth.user) return <Navigate to="/auth" replace />;
  if (adminOnly && auth.profile?.role === 'merchant') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        {/* Public */}
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/pay/:invoiceId" element={<CheckoutPage />} />

        {/* Merchant-protected */}
        <Route path="/onboarding" element={
          <ProtectedRoute><OnboardingPage /></ProtectedRoute>
        } />
        <Route path="/dashboard/*" element={
          <ProtectedRoute><DashboardPage /></ProtectedRoute>
        } />

        {/* Admin-protected */}
        <Route path="/admin/*" element={
          <ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>
        } />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

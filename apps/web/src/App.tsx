import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { HouseholdProvider, useMe } from './lib/session';
import { ErrorState, PageLoading } from './components/ui';
import { AppShell } from './components/AppShell';
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from './pages/auth/AuthPages';
import { InvitePage } from './pages/auth/InvitePage';
import { WelcomePage } from './pages/onboarding/WelcomePage';
import { DashboardPage } from './pages/dashboard/DashboardPage';

// Secondary screens are code-split to keep the first load small on phones.
const LedgerPage = lazy(() => import('./pages/ledger/LedgerPage'));
const BudgetPage = lazy(() => import('./pages/budget/BudgetPage'));
const PlannerPage = lazy(() => import('./pages/planner/PlannerPage'));
const HouseholdPage = lazy(() => import('./pages/household/HouseholdPage'));
const ActivityPage = lazy(() => import('./pages/activity/ActivityPage'));
const NotificationsPage = lazy(() => import('./pages/activity/NotificationsPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const OnboardingPage = lazy(() => import('./pages/onboarding/OnboardingPage'));

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const map: Record<string, string> = {
      '/': 'Dashboard',
      '/ledger': 'Spend',
      '/budget': 'Budget',
      '/planner': 'Planner',
      '/household': 'Household',
      '/activity': 'Activity',
      '/notifications': 'Notifications',
      '/settings': 'Settings',
      '/login': 'Sign in',
      '/register': 'Create account',
      '/onboarding': 'Set up',
    };
    const page = map[pathname];
    document.title = page ? `${page} · SynerPulse` : 'SynerPulse';
  }, [pathname]);
}

export function App() {
  useDocumentTitle();
  const me = useMe();
  const location = useLocation();

  if (me.isLoading) return <PageLoading />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;

  const user = me.data;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
      </Routes>
    );
  }

  // After signing in/up from an invitation link, return there.
  const from = (location.state as { from?: string } | null)?.from;
  const backTo = <Navigate to={from ?? '/'} replace />;

  if (!user.households.length) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/login" element={from ? backTo : <WelcomePage />} />
        <Route path="/register" element={from ? backTo : <WelcomePage />} />
        <Route path="*" element={<WelcomePage />} />
      </Routes>
    );
  }

  return (
    <HouseholdProvider me={user}>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/welcome" element={<WelcomePage allowCancel />} />
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="ledger" element={<LedgerPage />} />
            <Route path="budget" element={<BudgetPage />} />
            <Route path="planner" element={<PlannerPage />} />
            <Route path="household" element={<HouseholdPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="/login" element={backTo} />
          <Route path="/register" element={backTo} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </HouseholdProvider>
  );
}

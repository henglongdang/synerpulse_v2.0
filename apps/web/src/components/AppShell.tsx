import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  ChevronsUpDown,
  CloudOff,
  Gauge,
  Home,
  LayoutGrid,
  LineChart,
  LogOut,
  Plus,
  ReceiptText,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import { isDemoEmail, ROLE_LABELS } from '@familypulse/shared/client';
import { signOut, useHousehold } from '../lib/session';
import { flushOutbox, useOnline, useOutbox } from '../lib/outbox';
import { useToast } from '../lib/toast';
import { useInvalidate } from '../lib/queries';
import { Avatar, Button, IconButton, Menu } from './ui';
import { EntryDialogProvider, useEntryDialog } from '../features/entry/EntryDialog';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/ledger', label: 'Spend', icon: ReceiptText },
  { to: '/budget', label: 'Budget', icon: Gauge },
  { to: '/planner', label: 'Planner', icon: LineChart },
  { to: '/household', label: 'Household', icon: Users },
  { to: '/activity', label: 'Activity', icon: Activity },
];
// Prototype's bottom tab order: Spend · Budget · Dashboard · (Insight → Planner)
const BOTTOM = [NAV[1], NAV[2], NAV[0], NAV[3]];

const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/ledger': 'Spend',
  '/budget': 'Budget',
  '/planner': 'Planner',
  '/household': 'Household',
  '/activity': 'Activity',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
};

function UserMenu() {
  const { me, household, switchHousehold } = useHousehold();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <Menu
      align="right"
      width={260}
      trigger={(p) => (
        <button className="avatar-btn" aria-label="Account menu" {...p}>
          <Avatar id={me.user.id} name={me.user.name} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="menu-label">
            <div style={{ fontWeight: 600 }}>{me.user.name}</div>
            <div className="xs muted truncate">{me.user.email}</div>
          </div>
          <div className="menu-sep" />
          {me.households.length > 1 &&
            me.households.map((h) => (
              <button
                key={h.id}
                className="menu-item"
                role="menuitemradio"
                aria-checked={h.id === household.id}
                onClick={() => {
                  close();
                  void switchHousehold(h.id);
                }}
              >
                <Home size={16} /> <span className="grow truncate">{h.name}</span>
                {h.id === household.id && <span className="xs muted">Current</span>}
              </button>
            ))}
          {me.households.length > 1 && <div className="menu-sep" />}
          <Link className="menu-item" role="menuitem" to="/settings" onClick={close}>
            <Settings size={16} /> Settings
          </Link>
          <Link className="menu-item" role="menuitem" to="/household" onClick={close}>
            <Users size={16} /> Household & members
          </Link>
          <Link className="menu-item" role="menuitem" to="/activity" onClick={close}>
            <Activity size={16} /> Activity
          </Link>
          <div className="menu-sep" />
          <button
            className="menu-item"
            role="menuitem"
            onClick={async () => {
              close();
              await signOut(qc);
              navigate('/login');
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </>
      )}
    </Menu>
  );
}

function HouseholdSwitcher() {
  const { me, household, switchHousehold } = useHousehold();
  const navigate = useNavigate();
  return (
    <Menu
      align="left"
      width={240}
      trigger={(p) => (
        <button className="household-switch" {...p} aria-label={`Household: ${household.name}`}>
          <Home size={18} style={{ flex: 'none' }} />
          <span className="hs-text grow" style={{ minWidth: 0 }}>
            <span className="truncate" style={{ display: 'block', fontWeight: 600, fontSize: 'var(--text-sm)' }}>
              {household.name}
            </span>
            <span className="xs muted">
              {ROLE_LABELS[household.role]} · {household.memberCount} member{household.memberCount === 1 ? '' : 's'}
            </span>
          </span>
          <ChevronsUpDown size={16} className="hs-chev muted" />
        </button>
      )}
    >
      {(close) => (
        <>
          {me.households.map((h) => (
            <button
              key={h.id}
              className="menu-item"
              role="menuitemradio"
              aria-checked={h.id === household.id}
              onClick={() => {
                close();
                void switchHousehold(h.id);
              }}
            >
              <span className="grow truncate">{h.name}</span>
              {h.id === household.id && <span className="xs muted">Current</span>}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              close();
              navigate('/welcome');
            }}
          >
            <Plus size={16} /> New household
          </button>
        </>
      )}
    </Menu>
  );
}

function Shell() {
  const { me, household, can, hid } = useHousehold();
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();
  const pending = useOutbox(hid);
  const toast = useToast();
  const invalidate = useInvalidate();
  const entry = useEntryDialog();
  const unread = me.unreadNotifications;
  const title = TITLES[location.pathname] ?? 'FamilyPulse';

  // Replay offline entries when the connection returns (and once on load).
  useEffect(() => {
    if (!online) return;
    void flushOutbox().then((n) => {
      if (n > 0) {
        toast.success(`${n} offline ${n === 1 ? 'entry' : 'entries'} synced`);
        invalidate();
      }
    });
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const canAdd = can('transactions.create');
  const showFab = canAdd && ['/', '/ledger', '/budget'].includes(location.pathname);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <Link to="/" className="sidebar-logo" aria-label="FamilyPulse home">
          <img src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
          <img className="mark" src="/brand/familypulse-mark.svg" alt="" style={{ display: 'none' }} />
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
              <n.icon size={20} aria-hidden />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className="nav-item">
            <Settings size={20} aria-hidden />
            <span>Settings</span>
          </NavLink>
          <HouseholdSwitcher />
        </div>
      </aside>

      <div className="main">
        {household.isSample && (
          <div className="sample-bar" role="note">
            {isDemoEmail(me.user.email) ? (
              <>
                Shared demo with fictional data, reset daily.{' '}
                <button
                  className="link-btn"
                  onClick={async () => {
                    await signOut(qc);
                    navigate('/register');
                  }}
                >
                  Create your own account
                </button>
              </>
            ) : (
              'Sample household — all names and figures are fictional demo data.'
            )}
          </div>
        )}
        {!online && (
          <div className="offline-bar" role="status">
            <CloudOff size={16} aria-hidden /> You’re offline. Showing the last loaded data
            {pending.length ? ` · ${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} waiting to sync` : ''}.
          </div>
        )}
        <header className="topbar">
          <div className="mobile-only">
            <UserMenu />
          </div>
          <Link to="/" className="topbar-logo mobile-only" aria-label="FamilyPulse home">
            <img src="/brand/familypulse-logo.svg" alt="FamilyPulse" />
          </Link>
          <div className="topbar-context desktop-only">
            <span className="sr-only">{title} · </span>
            {household.name} <span className="muted">· {ROLE_LABELS[household.role]}</span>
          </div>
          <div className="topbar-actions">
            {canAdd && (
              <Button variant="primary" size="sm" className="desktop-only" icon={<Plus size={16} />} onClick={() => entry.open({})}>
                Add entry
              </Button>
            )}
            <IconButton label="Search the ledger" onClick={() => navigate('/ledger?focus=search')}>
              <Search size={20} />
            </IconButton>
            <IconButton label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => navigate('/notifications')}>
              <Bell size={20} />
              {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
            </IconButton>
            <div className="desktop-only">
              <UserMenu />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Main navigation">
        {BOTTOM.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <n.icon size={22} aria-hidden />
            {n.label}
          </NavLink>
        ))}
      </nav>
      {showFab && (
        <button className="fab" onClick={() => entry.open({})} aria-label="Add entry">
          <Plus size={20} /> Add
        </button>
      )}
    </div>
  );
}

export function AppShell() {
  return (
    <EntryDialogProvider>
      <Shell />
    </EntryDialogProvider>
  );
}

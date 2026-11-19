import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  Search,
  UserCircle2,
  X,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { ROLE_LABELS, getSchoolAccessMode } from '../lib/permissions';
import { Button } from './ui/Primitives';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface DashboardShellProps {
  title: string;
  breadcrumb?: string;
  navItems: NavItem[];
  onGlobalSearch?: (query: string) => void;
  globalSearchPlaceholder?: string;
  children: React.ReactNode;
}

export function DashboardShell({
  title,
  breadcrumb,
  navItems,
  onGlobalSearch,
  globalSearchPlaceholder = 'Search permitted records…',
  children,
}: DashboardShellProps) {
  const { activeUser, activeSchool, logout, isPreviewMode, exitDemoPreview } = useAuth();
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const accessMode = getSchoolAccessMode(activeSchool);
  const basePortalPath = activeUser ? `/${activeUser.role.replace('_', '-')}` : '/';

  const handleSearch = (val: string) => {
    setSearchValue(val);
    onGlobalSearch?.(val);
  };

  const renderSidebarNav = (isMobile = false) => (
    <div className="flex flex-col h-full bg-[#0B1528] text-slate-200">
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800/80">
        {(!collapsed || isMobile) && (
          <Link to="/" className="font-display font-extrabold text-base text-white tracking-tight truncate">
            AcademiaOne
          </Link>
        )}
        {!isMobile && (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Role & Tenant Context Header */}
      {(!collapsed || isMobile) && activeUser && (
        <div className="px-4 py-3.5 border-b border-slate-800/80">
          <p className="text-[11px] font-medium text-teal-400">
            {ROLE_LABELS[activeUser.role]}
          </p>
          <p className="text-xs font-semibold text-white truncate mt-0.5">
            {activeSchool?.name || (activeUser.role === 'main_head' ? 'Platform Administration' : 'Unassigned School')}
          </p>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            location.pathname === item.path ||
            location.pathname.startsWith(item.path + '/');
          return (
            <Link
              key={item.id}
              to={item.path}
              onClick={() => isMobile && setMobileOpen(false)}
              title={collapsed && !isMobile ? item.label : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {(!collapsed || isMobile) && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800/80 space-y-1">
        <Link
          to={`${basePortalPath}/profile`}
          onClick={() => isMobile && setMobileOpen(false)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <UserCircle2 className="w-4 h-4 shrink-0" />
          {(!collapsed || isMobile) && <span className="truncate">{activeUser?.displayName}</span>}
        </Link>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-red-300 cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {(!collapsed || isMobile) && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-all duration-150 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarNav(false)}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-64 h-full shadow-2xl">{renderSidebarNav(true)}</div>
          <div className="flex-1 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Demo Preview Mode Notice (Only visible when Main Head previews a seeded role) */}
        {isPreviewMode && activeUser && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <strong>Demo Role Preview:</strong> Viewing as <strong>{activeUser.displayName}</strong> ({ROLE_LABELS[activeUser.role]} · {activeSchool?.name || activeUser.schoolId})
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                exitDemoPreview();
                navigate('/main-head/dashboard');
              }}
            >
              Exit to Main Head
            </Button>
          </div>
        )}

        {/* Subscription Grace / Suspended Banner */}
        {accessMode.bannerMessage && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2.5 flex items-center gap-2.5 text-xs text-red-900">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{accessMode.bannerMessage}</span>
          </div>
        )}

        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              {breadcrumb && <p className="text-[11px] text-slate-400 truncate">{breadcrumb}</p>}
              <h1 className="text-base sm:text-lg font-bold font-display text-slate-900 truncate">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {onGlobalSearch && (
              <div className="hidden md:flex items-center relative w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="search"
                  value={searchValue}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={globalSearchPlaceholder}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-teal-600"
                />
              </div>
            )}

            <Link
              to={`${basePortalPath}/notifications`}
              className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>

            <Link
              to={`${basePortalPath}/profile`}
              className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200 text-xs text-slate-700 hover:text-slate-900"
            >
              <div className="w-8 h-8 rounded-lg bg-[#0B1528] text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                {(activeUser?.displayName || 'A').slice(0, 2).toUpperCase()}
              </div>
              <div className="text-left leading-tight max-w-[120px]">
                <p className="font-semibold truncate">{activeUser?.displayName}</p>
                <p className="text-[11px] text-slate-500">{activeUser ? ROLE_LABELS[activeUser.role] : ''}</p>
              </div>
            </Link>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

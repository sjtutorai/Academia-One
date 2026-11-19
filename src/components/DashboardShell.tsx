import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
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
  Settings,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationContext';
import { ROLE_LABELS, getSchoolAccessMode } from '../lib/permissions';
import {
  getDrawerVariants,
  getDropdownVariants,
  getModalBackdropVariants,
  getPageEntranceVariants,
  MOTION_EASE,
} from '../lib/motion';
import { Button } from './ui/Primitives';
import { BrandLogo } from './ui/BrandLogo';

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
  const prefersReducedMotion = useReducedMotion();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const accessMode = getSchoolAccessMode(activeSchool);
  const basePortalPath = activeUser ? `/${activeUser.role.replace('_', '-')}` : '/';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        setProfileMenuOpen(false);
      }
    };
    const onClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, []);

  const handleSearch = (val: string) => {
    setSearchValue(val);
    onGlobalSearch?.(val);
  };

  const renderSidebarNav = (isMobile = false) => (
    <div className="flex flex-col h-full bg-[#101C35] text-slate-200">
      <div className="h-14 px-3.5 flex items-center justify-between border-b border-slate-800/80 shrink-0">
        {(!collapsed || isMobile) ? (
          <Link to="/" className="min-w-0 hover:opacity-90 transition-opacity">
            <BrandLogo size="xs" tone="dark" />
          </Link>
        ) : (
          <Link to="/" className="mx-auto hover:opacity-90 transition-opacity" title="AcademiaOne">
            <BrandLogo size="xs" tone="dark" showWordmark={false} />
          </Link>
        )}
        {!isMobile && (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Role & Tenant Context Header */}
      {(!collapsed || isMobile) && activeUser && (
        <div className="px-4 py-2.5 border-b border-slate-800/80 shrink-0">
          <p className="text-[11px] font-medium text-teal-400">
            {ROLE_LABELS[activeUser.role]}
          </p>
          <p className="text-xs font-semibold text-white truncate mt-0.5">
            {activeSchool?.name || (activeUser.role === 'main_head' ? 'Platform Administration' : 'Unassigned School')}
          </p>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
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
              className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                active
                  ? 'text-white'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId={isMobile ? 'sidebar-active-mobile' : 'sidebar-active-desktop'}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: MOTION_EASE.out }}
                  className="absolute inset-0 rounded-lg bg-teal-600 shadow-sm"
                  aria-hidden="true"
                />
              )}
              <Icon className="w-4 h-4 shrink-0 relative z-10" />
              {(!collapsed || isMobile) && <span className="truncate relative z-10">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2.5 border-t border-slate-800/80 space-y-0.5 shrink-0">
        <Link
          to={`${basePortalPath}/profile`}
          onClick={() => isMobile && setMobileOpen(false)}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
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
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-red-300 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {(!collapsed || isMobile) && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  const pageVariants = getPageEntranceVariants(prefersReducedMotion);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderSidebarNav(false)}</div>
      </aside>

      {/* Mobile Animated Drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <motion.div
              variants={getModalBackdropVariants(prefersReducedMotion)}
              initial="initial"
              animate="animate"
              exit="exit"
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              variants={getDrawerVariants(prefersReducedMotion)}
              initial="initial"
              animate="animate"
              exit="exit"
              className="relative z-10 w-64 h-full shadow-2xl"
            >
              {renderSidebarNav(true)}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Demo Preview Mode Notice */}
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
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
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
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg transition-all duration-150 focus:outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                />
              </div>
            )}

            <Link
              to={`${basePortalPath}/notifications`}
              className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              aria-label="Notifications"
            >
              <Bell className="w-5 h-5" />
              <AnimatePresence>
                {unreadCount > 0 && (
                  <motion.span
                    key={unreadCount}
                    initial={prefersReducedMotion ? false : { scale: 0.75, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.75, opacity: 0 }}
                    transition={{ duration: 0.16, ease: MOTION_EASE.out }}
                    className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums"
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>

            {/* Profile Dropdown Menu */}
            <div ref={profileMenuRef} className="relative hidden sm:block pl-2 border-l border-slate-200">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((v) => !v)}
                className="flex items-center gap-2 text-xs text-slate-700 hover:text-slate-900 rounded-lg px-1.5 py-1 hover:bg-slate-50 transition-colors cursor-pointer"
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
              >
                <div className="w-8 h-8 rounded-lg bg-[#101C35] text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                  {(activeUser?.displayName || 'A').slice(0, 2).toUpperCase()}
                </div>
                <div className="text-left leading-tight max-w-[120px]">
                  <p className="font-semibold truncate">{activeUser?.displayName}</p>
                  <p className="text-[11px] text-slate-500">{activeUser ? ROLE_LABELS[activeUser.role] : ''}</p>
                </div>
              </button>

              <AnimatePresence>
                {profileMenuOpen && (
                  <motion.div
                    variants={getDropdownVariants(prefersReducedMotion)}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    role="menu"
                    className="absolute right-0 mt-2 w-52 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-40 origin-top-right"
                  >
                    <div className="px-3.5 py-2 border-b border-slate-100">
                      <p className="text-xs font-semibold text-slate-900 truncate">{activeUser?.displayName}</p>
                      <p className="text-[11px] text-slate-500 truncate">{activeUser?.email}</p>
                    </div>
                    <Link
                      to={`${basePortalPath}/profile`}
                      onClick={() => setProfileMenuOpen(false)}
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <UserCircle2 className="w-3.5 h-3.5 text-slate-500" />
                      Profile & Security
                    </Link>
                    {activeUser?.role === 'principal' && (
                      <Link
                        to="/principal/settings"
                        onClick={() => setProfileMenuOpen(false)}
                        role="menuitem"
                        className="flex items-center gap-2.5 px-3.5 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Settings className="w-3.5 h-3.5 text-slate-500" />
                        School Settings
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setProfileMenuOpen(false);
                        await logout();
                        navigate('/login');
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Smooth Page Content Viewport (Persistent Sidebar & Topbar Stable) */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

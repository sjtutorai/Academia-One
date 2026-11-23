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
import { PWAInstallButton } from './shared/PWAControls';

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
  const { activeUser, activeSchool, schoolLoading, logout, isPreviewMode, exitDemoPreview } = useAuth();
  const { unreadCount } = useNotifications();
  const location = useLocation();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const accessMode = getSchoolAccessMode(activeSchool);
  const basePortalPath = activeUser ? `/${activeUser.role.replace('_', '-')}` : '/';
  const bottomNavItems = navItems.slice(0, 4);

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
    <div className="flex flex-col h-full bg-[#0F295C] text-blue-100">
      <div className="h-14 px-3.5 flex items-center justify-between border-b border-blue-900/80 shrink-0">
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
            className="p-1.5 rounded-lg text-blue-300 hover:text-white hover:bg-blue-900/70 transition-colors cursor-pointer"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-blue-300 hover:text-white hover:bg-blue-900/70 transition-colors cursor-pointer"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Role & Tenant Context Header */}
      {(!collapsed || isMobile) && activeUser && (
        <div className="px-4 py-2.5 border-b border-blue-900/80 shrink-0">
          <p className="text-[11px] font-semibold text-yellow-300">
            {ROLE_LABELS[activeUser.role]}
          </p>
          <p className="text-xs font-semibold text-white truncate mt-0.5">
            {activeSchool?.name ||
              (activeUser.role === 'main_head'
                ? 'Platform Administration'
                : schoolLoading
                  ? 'Loading school…'
                  : activeUser.schoolId && activeUser.schoolId !== 'unassigned'
                    ? 'School Unavailable'
                    : 'Unassigned School')}
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
                  : 'text-blue-100/85 hover:bg-blue-900/60 hover:text-white'
              }`}
            >
              {active && (
                <motion.span
                  layoutId={isMobile ? 'sidebar-active-mobile' : 'sidebar-active-desktop'}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: MOTION_EASE.out }}
                  className="absolute inset-0 rounded-lg bg-blue-600 shadow-sm"
                  aria-hidden="true"
                />
              )}
              <Icon className="w-4 h-4 shrink-0 relative z-10" />
              {(!collapsed || isMobile) && <span className="truncate relative z-10">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2.5 border-t border-blue-900/80 space-y-1 shrink-0 safe-bottom">
        {(!collapsed || isMobile) && <PWAInstallButton variant="sidebar" />}
        <Link
          to={`${basePortalPath}/profile`}
          onClick={() => isMobile && setMobileOpen(false)}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-blue-100 hover:bg-blue-900/60 hover:text-white transition-colors min-h-[40px]"
        >
          <UserCircle2 className="w-4 h-4 shrink-0 text-green-400" />
          {(!collapsed || isMobile) && <span className="truncate">{activeUser?.displayName}</span>}
        </Link>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-blue-200 hover:bg-red-950/60 hover:text-red-300 transition-colors cursor-pointer min-h-[40px]"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {(!collapsed || isMobile) && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  const pageVariants = getPageEntranceVariants(prefersReducedMotion);

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div className="sticky top-0 h-[100dvh]">{renderSidebarNav(false)}</div>
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
              className="relative z-10 w-[min(82vw,288px)] h-full shadow-2xl"
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
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200 safe-top safe-x">
          <div className="h-14 sm:h-16 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="lg:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-blue-50 transition-colors cursor-pointer shrink-0"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                {breadcrumb && <p className="text-[11px] font-medium text-blue-600 truncate leading-tight">{breadcrumb}</p>}
                <h1 className="text-sm sm:text-lg font-bold font-display text-[#0F295C] truncate leading-tight">
                  {title}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              {onGlobalSearch && (
                <>
                  <div className="hidden md:flex items-center relative w-56 xl:w-72">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                    <input
                      type="search"
                      value={searchValue}
                      onChange={(e) => handleSearch(e.target.value)}
                      placeholder={globalSearchPlaceholder}
                      className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg transition-all duration-150 focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileSearchOpen((v) => !v)}
                    className="md:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer"
                    aria-label={mobileSearchOpen ? 'Close search' : 'Search records'}
                    aria-expanded={mobileSearchOpen}
                  >
                    {mobileSearchOpen ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
                  </button>
                </>
              )}

              <PWAInstallButton variant="compact" className="hidden sm:inline-flex" />

              <Link
                to={`${basePortalPath}/notifications`}
                className="relative min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
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
                      className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </motion.span>
                  )}
                </AnimatePresence>
              </Link>

              {/* Profile Dropdown Menu (Accessible on both Mobile & Desktop) */}
              <div ref={profileMenuRef} className="relative sm:pl-2 sm:border-l sm:border-slate-200">
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((v) => !v)}
                  className="flex items-center gap-2 text-xs text-slate-700 hover:text-slate-900 rounded-lg p-1 sm:px-1.5 hover:bg-blue-50/60 transition-colors cursor-pointer min-h-[40px]"
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Account menu"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                    {(activeUser?.displayName || 'A').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="hidden sm:block text-left leading-tight max-w-[120px]">
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
                      className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-40 origin-top-right"
                    >
                      <div className="px-3.5 py-2 border-b border-slate-100">
                        <p className="text-xs font-semibold text-slate-900 truncate">{activeUser?.displayName}</p>
                        <p className="text-[11px] text-slate-500 truncate">{activeUser?.email}</p>
                      </div>
                      <Link
                        to={`${basePortalPath}/profile`}
                        onClick={() => setProfileMenuOpen(false)}
                        role="menuitem"
                        className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <UserCircle2 className="w-4 h-4 text-slate-500" />
                        Profile & Security
                      </Link>
                      {activeUser?.role === 'principal' && (
                        <Link
                          to="/principal/settings"
                          onClick={() => setProfileMenuOpen(false)}
                          role="menuitem"
                          className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <Settings className="w-4 h-4 text-slate-500" />
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
                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Expandable Mobile Search Bar */}
          {onGlobalSearch && mobileSearchOpen && (
            <div className="md:hidden px-3 pb-3 pt-1 border-t border-slate-100 bg-white">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="search"
                  autoFocus
                  value={searchValue}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={globalSearchPlaceholder}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                />
              </div>
            </div>
          )}
        </header>

        {/* Smooth Page Content Viewport (Persistent Sidebar & Topbar Stable) */}
        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-[1600px] w-full mx-auto safe-x">
          <motion.div
            key={location.pathname}
            variants={pageVariants}
            initial="initial"
            animate="animate"
          >
            {children}
          </motion.div>
        </main>

        {/* Mobile & Compact Tablet Bottom Navigation Bar */}
        <nav
          aria-label="Primary mobile navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 safe-bottom safe-x"
        >
          <div className="grid grid-cols-5 h-14 items-center max-w-xl mx-auto">
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              const active =
                location.pathname === item.path ||
                location.pathname.startsWith(item.path + '/');
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={`flex flex-col items-center justify-center gap-0.5 h-full px-1 transition-colors ${
                    active ? 'text-blue-700 font-semibold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="text-[10px] leading-tight truncate max-w-full">{item.label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex flex-col items-center justify-center gap-0.5 h-full px-1 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Open full menu"
            >
              <Menu className="w-5 h-5 shrink-0" />
              <span className="text-[10px] leading-tight">More</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

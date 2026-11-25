import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Building2,
  ShieldCheck,
  CalendarClock,
  ClipboardCheck,
  BookOpenCheck,
  BellRing,
  Menu,
  X,
  ArrowRight,
  ChevronDown,
  Check,
  Mail,
  Phone,
  MapPin,
  Sparkles,
} from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, generateId } from '../lib/firebase';
import { ROLE_HOME_ROUTES } from '../lib/permissions';
import {
  getStaggerContainerVariants,
  getStaggerItemVariants,
  MOTION_EASE,
} from '../lib/motion';
import { useAuth } from '../contexts/AuthContext';
import { ThemeToggleButton, useTheme } from '../contexts/ThemeContext';
import { Button, useToast } from '../components/ui/Primitives';
import { BrandLogo } from '../components/ui/BrandLogo';
import { PWAInstallButton } from '../components/shared/PWAControls';
import { isValidPhoneDigits, sanitizePhoneDigits } from '../lib/schoolCodes';
import type { PlatformSettings } from '../types/models';

const FAQS = [
  {
    q: 'Is SJ Academia One completely free for schools?',
    a: 'Yes. Every verified school receives 100% free unlimited access to all five role portals, attendance tracking, conflict-checked timetables, examinations, homework submissions, CSV imports, and analytics—with no paid tiers or hidden fees.',
  },
  {
    q: 'How does SJ Academia One isolate data between independent schools?',
    a: 'Every school-owned document—students, teachers, classes, timetables, exams, marks, homework, and announcements—carries an immutable schoolId tenant key. Firestore security rules validate the signed-in user profile against that schoolId on every read and write.',
  },
  {
    q: 'Why is there no role dropdown on the Sign In screen?',
    a: 'SJ Academia One uses a single unified login page with Username/Email and Password or Google Sign-In. After authentication, the platform resolves your verified role and school assignment from Firestore and automatically directs you to the authorized portal.',
  },
  {
    q: 'How do notifications and user preferences work?',
    a: 'Users receive real-time in-app alerts and optional Browser Push notifications for announcements, homework reminders, and published exams, with per-category controls in Notification Preferences.',
  },
];

export default function LandingPage() {
  const { activeUser } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [settings, setSettings] = useState<Partial<PlatformSettings>>({
    platformName: 'SJ Academia One',
    supportEmail: 'support@academiaone.edu',
    supportPhone: '+1 (800) 555-0199',
    allowPublicRegistration: true,
  });

  // School Registration / Enquiry Form State
  const [enquiry, setEnquiry] = useState({
    schoolName: '',
    contactName: '',
    email: '',
    phone: '',
    estimatedStudents: '350',
    message: '',
  });
  const [submittingEnquiry, setSubmittingEnquiry] = useState(false);
  const [enquirySubmitted, setEnquirySubmitted] = useState(false);
  const [enquiryError, setEnquiryError] = useState('');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    getDoc(doc(db, 'platformSettings', 'global'))
      .then((snap) => {
        if (snap.exists()) setSettings(snap.data() as PlatformSettings);
      })
      .catch(() => undefined);
  }, []);

  const handleEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnquiryError('');
    if (enquiry.schoolName.trim().length < 2 || enquiry.contactName.trim().length < 2) {
      setEnquiryError('Please provide both your school name and primary contact name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiry.email.trim())) {
      setEnquiryError('Please enter a valid work email address.');
      return;
    }
    if (enquiry.phone.trim() && !isValidPhoneDigits(enquiry.phone.trim())) {
      setEnquiryError('Phone number must contain only 10 to 15 numeric digits.');
      return;
    }
    setSubmittingEnquiry(true);
    try {
      const id = generateId('enq');
      await setDoc(doc(db, 'schoolEnquiries', id), {
        id,
        schoolName: enquiry.schoolName.trim().slice(0, 140),
        contactName: enquiry.contactName.trim().slice(0, 120),
        email: enquiry.email.trim().toLowerCase().slice(0, 160),
        phone: sanitizePhoneDigits(enquiry.phone),
        estimatedStudents: Number(enquiry.estimatedStudents) || 0,
        message: enquiry.message.trim().slice(0, 1000),
        status: 'new',
        createdAt: serverTimestamp(),
      });
      setEnquirySubmitted(true);
      setEnquiry({ schoolName: '', contactName: '', email: '', phone: '', estimatedStudents: '350', message: '' });
      pushToast('success', 'School enquiry submitted. The platform team will follow up shortly.');
    } catch {
      setEnquiryError('Could not submit your enquiry right now. Please email support directly.');
    } finally {
      setSubmittingEnquiry(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Sticky Top Navigation */}
      <header
        className={`sticky top-0 z-40 transition-all duration-200 border-b safe-top ${
          scrolled
            ? 'bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-slate-200 dark:border-slate-800 py-3 shadow-xs'
            : 'bg-[#0F295C] border-blue-900/80 py-4'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
          <Link
            to="/"
            className="whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
          >
            <BrandLogo size="md" tone={scrolled && !isDark ? 'light' : 'dark'} />
          </Link>

          <nav
            aria-label="Primary Navigation"
            className={`hidden lg:flex items-center gap-7 text-sm font-medium ${
              scrolled ? 'text-slate-600 dark:text-slate-300' : 'text-blue-100'
            }`}
          >
            <a href="#features" className="nav-link-underline hover:text-blue-400 transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <a href="#portals" className="nav-link-underline hover:text-red-400 transition-colors whitespace-nowrap shrink-0">
              For Schools
            </a>
            <a href="#how-it-works" className="nav-link-underline hover:text-yellow-400 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#contact" className="nav-link-underline hover:text-green-400 transition-colors whitespace-nowrap shrink-0">
              Contact
            </a>
          </nav>

          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <ThemeToggleButton variant={scrolled ? 'icon' : 'dark-surface'} />
            <PWAInstallButton
              variant="compact"
              className={scrolled ? '' : '!bg-blue-800/80 !text-white !border-blue-700 hover:!bg-blue-700'}
            />
            {activeUser ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate(ROLE_HOME_ROUTES[activeUser.role])}
              >
                Open Dashboard
              </Button>
            ) : (
              <>
                <Link
                  to="/application-status"
                  className={`nav-link-underline text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    scrolled ? 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Track Application
                </Link>
                <Link
                  to="/login"
                  className={`nav-link-underline text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    scrolled ? 'text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white' : 'text-slate-200 hover:text-white'
                  }`}
                >
                  Sign In
                </Link>
                <Button variant="primary" size="sm" onClick={() => navigate('/register-school')}>
                  Register School Free
                </Button>
              </>
            )}
          </div>

          <div className="flex lg:hidden items-center gap-2">
            <ThemeToggleButton variant={scrolled ? 'icon' : 'dark-surface'} />
            <PWAInstallButton
              variant="compact"
              className={scrolled ? '' : '!bg-blue-800/80 !text-white !border-blue-700 hover:!bg-blue-700'}
            />
            <button
              type="button"
              className={`p-2 rounded-lg transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center ${scrolled ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800' : 'text-white hover:bg-slate-800'}`}
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Responsive Mobile Drawer */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: MOTION_EASE.out }}
              className="lg:hidden bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-6 py-5 space-y-4 shadow-md"
            >
              <div className="flex flex-col gap-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
                <a href="#portals" onClick={() => setMobileMenuOpen(false)}>For Schools</a>
                <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
                <a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
                <a href="#contact" onClick={() => setMobileMenuOpen(false)}>Contact</a>
                <Link to="/application-status" onClick={() => setMobileMenuOpen(false)} className="text-teal-700 dark:text-blue-400">
                  Track Application Status
                </Link>
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                <PWAInstallButton variant="header" className="w-full" />
                <div className="flex items-center gap-3">
                  <Button variant="secondary" className="flex-1" onClick={() => navigate('/login')}>
                    Sign In
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={() => navigate('/register-school')}>
                    Register School
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Hero Section: Deep Cobalt Blue with Subtle 4-Color Ambient Orbs (Blue, Red, Yellow, Green) */}
      <section className="bg-gradient-to-br from-[#0F295C] via-[#13326E] to-[#17397A] text-white relative overflow-hidden">
        <div
          className="hidden md:block absolute -top-24 -right-16 w-[440px] h-[440px] rounded-full pointer-events-none opacity-25 blur-3xl animate-orb-slow"
          style={{ background: 'radial-gradient(circle, #2563EB 0%, transparent 70%)' }}
          aria-hidden="true"
        />
        <div
          className="hidden md:block absolute top-1/3 right-1/4 w-[280px] h-[280px] rounded-full pointer-events-none opacity-20 blur-3xl animate-orb-reverse"
          style={{ background: 'radial-gradient(circle, #EA4335 0%, transparent 70%)' }}
          aria-hidden="true"
        />
        <div
          className="hidden md:block absolute -bottom-24 left-1/3 w-[340px] h-[340px] rounded-full pointer-events-none opacity-15 blur-3xl animate-orb-slow"
          style={{ background: 'radial-gradient(circle, #FBBC05 0%, transparent 70%)' }}
          aria-hidden="true"
        />
        <div
          className="hidden md:block absolute -bottom-28 -left-24 w-[420px] h-[420px] rounded-full pointer-events-none opacity-20 blur-3xl animate-orb-reverse"
          style={{ background: 'radial-gradient(circle, #34A853 0%, transparent 70%)' }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-15"
          style={{
            backgroundImage: 'radial-gradient(rgba(191,219,254,0.35) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />

        <div className="max-w-7xl mx-auto px-6 py-16 lg:py-24 relative">
          <motion.div
            variants={getStaggerContainerVariants(prefersReducedMotion, 0.08)}
            initial="hidden"
            animate="visible"
            className="max-w-4xl"
          >
            <motion.p
              variants={getStaggerItemVariants(prefersReducedMotion, 10)}
              className="text-xs font-semibold text-yellow-300 tracking-wide mb-3.5"
            >
              100% Free for All Schools · Main Head Verified · Strict Tenant Isolation
            </motion.p>
            <motion.h1
              variants={getStaggerItemVariants(prefersReducedMotion, 14)}
              className="font-display font-bold tracking-tight text-white text-balance leading-[1.08]"
              style={{ fontSize: 'clamp(2.35rem, 4.2vw, 3.65rem)' }}
            >
              One unified platform connecting school leadership, teachers, and students.
            </motion.h1>
            <motion.p
              variants={getStaggerItemVariants(prefersReducedMotion, 12)}
              className="mt-5 text-base sm:text-lg text-blue-100 leading-relaxed max-w-2xl"
            >
              Register your school completely free, receive dedicated role-specific School Access Codes upon Main Head
              approval, and run conflict-checked timetables, attendance, exams, and homework across five portals.
            </motion.p>
            <motion.div
              variants={getStaggerItemVariants(prefersReducedMotion, 10)}
              className="mt-8 flex flex-wrap items-center gap-3.5"
            >
              <Button variant="primary" size="lg" onClick={() => navigate('/register-school')}>
                Register Your School Free
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="!bg-transparent !text-white !border-blue-300/50 hover:!bg-white/10"
                onClick={() => navigate(activeUser ? ROLE_HOME_ROUTES[activeUser.role] : '/login')}
              >
                {activeUser ? 'Go to My Portal' : 'Sign In'}
              </Button>
              <Link
                to="/application-status"
                className="inline-flex items-center justify-center px-3 py-3 text-sm font-medium text-yellow-300 hover:text-yellow-200 transition-colors whitespace-nowrap"
              >
                Track Application →
              </Link>
            </motion.div>
            <motion.div
              variants={getStaggerItemVariants(prefersReducedMotion, 10)}
              className="mt-10 pt-8 border-t border-blue-400/25 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-2xl"
            >
              <div>
                <p className="text-xl font-bold font-display tabular-nums text-blue-300">5 Portals</p>
                <p className="text-xs text-blue-100/80 mt-1">Email & Google auto-routing</p>
              </div>
              <div>
                <p className="text-xl font-bold font-display tabular-nums text-green-300">100% Free</p>
                <p className="text-xs text-blue-100/80 mt-1">All modules included</p>
              </div>
              <div>
                <p className="text-xl font-bold font-display tabular-nums text-yellow-300">Role Access Codes</p>
                <p className="text-xs text-blue-100/80 mt-1">Auto-identifies school, role & class</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Core Capabilities */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-16">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-teal-700 tracking-wide">Platform Capabilities</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold font-display text-slate-900 tracking-tight text-balance">
            Structured school administration without fragmented spreadsheets
          </h2>
        </div>

        <motion.div
          variants={getStaggerContainerVariants(prefersReducedMotion, 0.06)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.15 }}
          className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {[
            {
              num: '01',
              icon: Building2,
              bar: 'bg-blue-600',
              iconColor: 'text-blue-600',
              title: 'Multi-School Tenant Isolation',
              body: 'Every class, roster, attendance sheet, and result carries an enforced schoolId key verified in Firestore security rules.',
            },
            {
              num: '02',
              icon: ShieldCheck,
              bar: 'bg-red-600',
              iconColor: 'text-red-600',
              title: 'Unified Role-Free Sign-In',
              body: 'One login form for every user. Credentials automatically resolve role, school scope, and forced password resets.',
            },
            {
              num: '03',
              icon: CalendarClock,
              bar: 'bg-yellow-400',
              iconColor: 'text-yellow-600',
              title: 'Conflict-Checked Timetables & Rooms',
              body: 'Detect teacher, class, and room double-bookings plus room capacity conflicts before publishing schedules.',
            },
            {
              num: '04',
              icon: ClipboardCheck,
              bar: 'bg-green-600',
              iconColor: 'text-green-600',
              title: 'Audited Attendance & Bounded Marks',
              body: 'Teachers draft and submit daily attendance with change histories and enter exam marks validated against max marks.',
            },
            {
              num: '05',
              icon: BookOpenCheck,
              bar: 'bg-blue-600',
              iconColor: 'text-blue-600',
              title: 'Homework, Submissions & CSV Bulk Ops',
              body: 'Import students via validated CSV templates, assign homework, collect files, and return inline teacher feedback.',
            },
            {
              num: '06',
              icon: BellRing,
              bar: 'bg-red-600',
              iconColor: 'text-red-600',
              title: 'Push & In-App Notification Engine',
              body: 'Real-time alerts for announcements, homework reminders, and published exams with per-user preference controls.',
            },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.num}
                variants={getStaggerItemVariants(prefersReducedMotion, 12)}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-sm"
              >
                <div className={`h-1 w-full ${f.bar}`} aria-hidden="true" />
                <div className="p-5">
                  <div className="flex items-center justify-between mb-3.5">
                    <span className="text-xs font-mono text-slate-400">{f.num}</span>
                    <Icon className={`w-5 h-5 ${f.iconColor}`} />
                  </div>
                  <h3 className="text-base font-bold font-display text-[#0F295C]">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{f.body}</p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      {/* Five Role-Based Portals + Free Forever Banner */}
      <section id="portals" className="bg-white border-y border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold text-red-600 tracking-wide">Role-Based Portals</p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-bold font-display text-[#0F295C] tracking-tight text-balance">
                Least-privilege workspaces tailored to every school role
              </h2>
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-green-50 border border-green-200 text-xs font-semibold text-green-800">
              <Sparkles className="w-4 h-4 text-green-600 shrink-0" />
              100% Free Unlimited Access for Every School
            </div>
          </div>

          <motion.div
            variants={getStaggerContainerVariants(prefersReducedMotion, 0.05)}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.15 }}
            className="mt-10 grid md:grid-cols-2 lg:grid-cols-5 gap-4"
          >
            {[
              {
                role: 'Main Head',
                scope: 'Platform Owner',
                bar: 'bg-blue-600',
                accent: 'text-blue-700',
                check: 'text-blue-600',
                items: ['Verify & approve schools', 'Issue unique School Codes', 'Change school passwords', 'Append-only audit logs'],
              },
              {
                role: 'Principal',
                scope: 'Single School Admin',
                bar: 'bg-red-600',
                accent: 'text-red-700',
                check: 'text-red-600',
                items: ['GPS campus address setup', 'Coordinators, teachers & CSV', 'Classes, rooms & timetables', 'Exams, notices & reports'],
              },
              {
                role: 'Coordinator',
                scope: 'Assigned Classes',
                bar: 'bg-yellow-400',
                accent: 'text-yellow-700',
                check: 'text-yellow-600',
                items: ['Monitor attendance alerts', 'Review class timetables', 'Coordinate exam dates', 'Flag issues for Principal'],
              },
              {
                role: 'Teacher',
                scope: 'Assigned Subjects',
                bar: 'bg-green-600',
                accent: 'text-green-700',
                check: 'text-green-600',
                items: ['Daily classes & agenda', 'Draft/submit attendance', 'Homework & marks entry', 'Upload learning materials'],
              },
              {
                role: 'Student',
                scope: 'Personal Portal',
                bar: 'bg-blue-600',
                accent: 'text-blue-700',
                check: 'text-blue-600',
                items: ['Weekly class timetable', 'Online homework upload', 'Published exam results', 'Attendance & resources'],
              },
            ].map((p) => (
              <motion.div
                key={p.role}
                variants={getStaggerItemVariants(prefersReducedMotion, 10)}
                className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex flex-col transition-all duration-200 hover:border-blue-200 hover:bg-white hover:shadow-xs"
              >
                <div className={`h-1 w-full ${p.bar}`} aria-hidden="true" />
                <div className="p-5 flex flex-col flex-1">
                  <p className={`text-xs font-semibold ${p.accent}`}>{p.scope}</p>
                  <h3 className="text-base font-bold font-display text-[#0F295C] mt-1">{p.role}</h3>
                  <ul className="mt-3.5 space-y-2 text-xs text-slate-600 flex-1">
                    {p.items.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <Check className={`w-3.5 h-3.5 ${p.check} shrink-0 mt-0.5`} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* How Onboarding Works */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-16">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-green-700 tracking-wide">Onboarding Workflow</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold font-display text-[#0F295C] tracking-tight text-balance">
            From school registration to live classrooms in four structured steps
          </h2>
        </div>

        <motion.div
          variants={getStaggerContainerVariants(prefersReducedMotion, 0.06)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.15 }}
          className="mt-10 grid md:grid-cols-4 gap-5"
        >
          {[
            { step: '01', bar: 'bg-blue-600', numColor: 'text-blue-600', title: 'Free 6-Step Application', desc: 'Submit institutional, GPS-verified campus address, Principal, and academic details to receive a trackable Application Number.' },
            { step: '02', bar: 'bg-red-600', numColor: 'text-red-600', title: 'Main Head Approval', desc: 'Main Head verifies your school and auto-issues a unique School Code while enabling Principal Email & Google login.' },
            { step: '03', bar: 'bg-yellow-400', numColor: 'text-yellow-600', title: 'Post-Approval Setup', desc: 'Principal configures classes, sections, campus rooms, and pre-registers staff & student email IDs.' },
            { step: '04', bar: 'bg-green-600', numColor: 'text-green-600', title: 'Smart Member Access', desc: 'Registered emails enter directly on sign-in; members enter their role access code to auto-identify school, role & class.' },
          ].map((item) => (
            <motion.div
              key={item.step}
              variants={getStaggerItemVariants(prefersReducedMotion, 10)}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden transition-all duration-200 hover:border-blue-200 hover:shadow-sm"
            >
              <div className={`h-1 w-full ${item.bar}`} aria-hidden="true" />
              <div className="p-5">
                <p className={`text-2xl font-bold font-mono tabular-nums ${item.numColor}`}>{item.step}</p>
                <h3 className="mt-2.5 text-base font-bold font-display text-[#0F295C]">{item.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* FAQ + School Registration Enquiry & Contact */}
      <section id="faq" className="bg-white border-t border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 items-start">
          {/* FAQ Column */}
          <div className="lg:col-span-5">
            <p className="text-xs font-semibold text-teal-700 tracking-wide">Frequently Asked Questions</p>
            <h2 className="mt-2 text-2xl font-bold font-display text-slate-900 tracking-tight">
              Security, access & onboarding answers
            </h2>
            <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
              {FAQS.map((item, idx) => (
                <div key={item.q} className="py-3.5">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left text-sm font-semibold text-slate-900 cursor-pointer"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                        openFaq === idx ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {openFaq === idx && (
                      <motion.p
                        initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={prefersReducedMotion ? undefined : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: MOTION_EASE.out }}
                        className="mt-2 text-sm text-slate-600 leading-relaxed overflow-hidden"
                      >
                        {item.a}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-2 text-sm text-slate-600">
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-blue-600" />
                <span>{settings.supportEmail || 'support@academiaone.edu'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-green-600" />
                <span>{settings.supportPhone || '+1 (800) 555-0199'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 text-red-600" />
                <span>Multi-Region Cloud Platform · 100% Free for Schools</span>
              </div>
            </div>
          </div>

          {/* School Registration Enquiry Form */}
          <div id="contact" className="lg:col-span-7 bg-[#F8FAFC] border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-7">
            <h3 className="text-xl font-bold font-display text-[#0F295C]">
              School Onboarding Enquiry
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Have questions before submitting your free school application? Send a message directly to the Main Head team.
            </p>

            {settings.allowPublicRegistration === false ? (
              <div className="mt-6 p-5 bg-white border border-slate-200 rounded-lg text-sm text-slate-600">
                Public school self-enquiries are currently paused by the platform administrator. Please contact{' '}
                <span className="font-semibold text-slate-900">{settings.supportEmail}</span> directly.
              </div>
            ) : enquirySubmitted ? (
              <div className="mt-6 p-6 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-semibold text-green-900">Enquiry received</p>
                <p className="text-sm text-green-800 mt-1">
                  Thank you. Your school enquiry has been logged for review by the Main Head team.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setEnquirySubmitted(false)}
                >
                  Submit Another Enquiry
                </Button>
              </div>
            ) : (
              <form onSubmit={handleEnquirySubmit} className="mt-5 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">School Name *</label>
                    <input
                      type="text"
                      required
                      value={enquiry.schoolName}
                      onChange={(e) => setEnquiry({ ...enquiry, schoolName: e.target.value })}
                      placeholder="Enter school name"
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Contact Person *</label>
                    <input
                      type="text"
                      required
                      value={enquiry.contactName}
                      onChange={(e) => setEnquiry({ ...enquiry, contactName: e.target.value })}
                      placeholder="Enter contact person name"
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Official Email *</label>
                    <input
                      type="email"
                      required
                      value={enquiry.email}
                      onChange={(e) => setEnquiry({ ...enquiry, email: e.target.value })}
                      placeholder="Enter official email"
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Phone (Numbers only)</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={15}
                      value={enquiry.phone}
                      onChange={(e) => setEnquiry({ ...enquiry, phone: sanitizePhoneDigits(e.target.value) })}
                      placeholder="Enter phone number"
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg tabular-nums transition-colors focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Est. Students</label>
                    <input
                      type="number"
                      min={10}
                      max={20000}
                      value={enquiry.estimatedStudents}
                      onChange={(e) => setEnquiry({ ...enquiry, estimatedStudents: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg tabular-nums transition-colors focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Academic Requirements</label>
                  <textarea
                    rows={3}
                    value={enquiry.message}
                    onChange={(e) => setEnquiry({ ...enquiry, message: e.target.value })}
                    placeholder="Share grade levels, target start semester, or migration needs..."
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg transition-colors focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15"
                  />
                </div>

                {enquiryError && <p className="text-xs text-red-600">{enquiryError}</p>}

                <div className="flex items-center justify-end">
                  <Button type="submit" variant="navy" loading={submittingEnquiry}>
                    {submittingEnquiry ? 'Submitting…' : 'Submit School Enquiry'}
                  </Button>
                </div>
              </form>
            )}
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="bg-[#0F295C] text-blue-200/80 border-t border-blue-900">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <BrandLogo
              size="sm"
              tone="dark"
              subtitle="Free Multi-School Management Platform · Strict Tenant Isolation"
            />
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <Link to="/register-school" className="text-yellow-300 hover:text-yellow-200 font-medium transition-colors">Register School</Link>
            <Link to="/application-status" className="hover:text-white transition-colors">Track Application</Link>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <Link to="/login" className="hover:text-white transition-colors">Sign In</Link>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

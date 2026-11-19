import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
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
} from 'lucide-react';
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, generateId } from '../lib/firebase';
import { ROLE_HOME_ROUTES } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { Button, useToast } from '../components/ui/Primitives';
import type { PlatformSettings, SubscriptionPlan } from '../types/models';

const FALLBACK_PLANS: Pick<SubscriptionPlan, 'id' | 'name' | 'tier' | 'priceMonthly' | 'billingInterval' | 'maxStudents' | 'maxTeachers' | 'storageGb' | 'description' | 'enabledModules'>[] = [
  {
    id: 'plan_free',
    name: 'Free Starter',
    tier: 'free',
    priceMonthly: 0,
    billingInterval: 'monthly',
    maxStudents: 100,
    maxTeachers: 12,
    storageGb: 5,
    description: 'For small academies piloting structured attendance and timetables.',
    enabledModules: ['Attendance', 'Weekly Timetable', 'Announcements'],
  },
  {
    id: 'plan_basic',
    name: 'Basic Campus',
    tier: 'basic',
    priceMonthly: 99,
    billingInterval: 'monthly',
    maxStudents: 400,
    maxTeachers: 35,
    storageGb: 25,
    description: 'Core daily administration for growing independent schools.',
    enabledModules: ['Attendance', 'Timetable', 'Homework', 'School Reports'],
  },
  {
    id: 'plan_standard',
    name: 'Standard Academic',
    tier: 'standard',
    priceMonthly: 249,
    billingInterval: 'monthly',
    maxStudents: 1500,
    maxTeachers: 120,
    storageGb: 100,
    description: 'Complete exam schedules, marks validation, CSV import, and coordinators.',
    enabledModules: ['All Basic Modules', 'Examinations & Marks', 'CSV Bulk Import', 'Learning Resources'],
  },
  {
    id: 'plan_premium',
    name: 'Premium Multi-Campus',
    tier: 'premium',
    priceMonthly: 499,
    billingInterval: 'annual',
    maxStudents: 5000,
    maxTeachers: 400,
    storageGb: 500,
    description: 'High-capacity campuses with audit exports and priority onboarding.',
    enabledModules: ['All Standard Modules', 'Audit Log Exports', 'Priority Support', 'Extended Storage'],
  },
];

const PREVIEW_TABS = [
  {
    id: 'main_head',
    label: 'Main Head',
    headline: 'Multi-School Oversight & Subscription Governance',
    metrics: [
      { label: 'Active Schools', value: '2 Demo Tenants' },
      { label: 'Enforced Isolation', value: 'schoolId Rules' },
      { label: 'Audit Logging', value: 'Append-Only' },
    ],
    rows: [
      { col1: 'Northridge Preparatory Academy', col2: 'Standard Academic', col3: 'Active', col4: '2027-08-31' },
      { col1: 'Crestview International School', col2: 'Premium Multi-Campus', col3: 'Trial', col4: '2026-12-01' },
    ],
    columns: ['School Name', 'Plan', 'Status', 'Renewal'],
  },
  {
    id: 'principal',
    label: 'Principal',
    headline: 'Single-School Administration & Conflict-Checked Scheduling',
    metrics: [
      { label: 'Conflict Guard', value: 'Teacher · Room · Class' },
      { label: 'Bulk Import', value: 'Validated CSV' },
      { label: 'Coordinator Scope', value: 'Configurable' },
    ],
    rows: [
      { col1: 'Grade 10 - Section A', col2: 'Prof. Elena Rostova', col3: 'East Wing 201', col4: '32 seats' },
      { col1: 'Grade 10 - Section B', col2: 'Mr. David Okafor', col3: 'East Wing 202', col4: '32 seats' },
    ],
    columns: ['Class / Section', 'Class Teacher', 'Assigned Room', 'Capacity'],
  },
  {
    id: 'teacher',
    label: 'Teacher',
    headline: 'Daily Agenda, Attendance Registers & Bounded Marks Entry',
    metrics: [
      { label: 'Attendance Mode', value: 'Draft -> Submit' },
      { label: 'Marks Validation', value: '0 to Max Marks' },
      { label: 'Homework Review', value: 'Inline Feedback' },
    ],
    rows: [
      { col1: '08:30 – 09:20', col2: 'Mathematics', col3: 'Grade 10 - A', col4: 'East Wing 201' },
      { col1: '09:25 – 10:15', col2: 'Mathematics', col3: 'Grade 10 - B', col4: 'East Wing 202' },
    ],
    columns: ['Time', 'Subject', 'Section', 'Room'],
  },
  {
    id: 'student',
    label: 'Student',
    headline: 'Personal Timetable, Homework Upload & Published Results',
    metrics: [
      { label: 'Results Access', value: 'Published Only' },
      { label: 'Attendance View', value: 'Read-Only Calendar' },
      { label: 'Privacy Scope', value: 'Own Records Only' },
    ],
    rows: [
      { col1: 'Quadratic Optimization Set', col2: 'Mathematics', col3: 'Completed', col4: 'Due Nov 22' },
      { col1: 'Refraction Lab Report', col2: 'Physics', col3: 'Open', col4: 'Due Nov 25' },
    ],
    columns: ['Assignment', 'Subject', 'Status', 'Deadline'],
  },
];

const FAQS = [
  {
    q: 'How does AcademiaOne isolate data between independent schools?',
    a: 'Every school-owned document—students, teachers, classes, timetables, exams, marks, homework, and announcements—carries an immutable schoolId tenant key. Firestore security rules validate the signed-in user profile against that schoolId on every read and write, denying cross-school requests at the data layer.',
  },
  {
    q: 'Why is there no role dropdown on the Sign In screen?',
    a: 'AcademiaOne uses a single unified login page with Username/Email and Password only. After authentication, the platform resolves your verified role and school assignment from Firestore and automatically directs you to the authorized portal.',
  },
  {
    q: 'What happens if a school subscription expires?',
    a: 'School records are never silently deleted on expiry. Expired schools transition into a safe read-only grace mode until the Main Head records a manual renewal or extends the subscription term.',
  },
  {
    q: 'How do push notifications and user preferences work?',
    a: 'Users receive real-time in-app alerts and optional Browser Push notifications for new messages, task/homework reminders, published exams, and special offers. Every user can toggle Push vs. In-App delivery per category in Notification Preferences.',
  },
];

export default function LandingPage() {
  const { activeUser } = useAuth();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState('main_head');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [settings, setSettings] = useState<Partial<PlatformSettings>>({
    platformName: 'AcademiaOne',
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

    getDocs(collection(db, 'subscriptionPlans'))
      .then((snap) => {
        if (!snap.empty) {
          const loaded = snap.docs
            .map((d) => d.data() as SubscriptionPlan)
            .filter((p) => p.status === 'active')
            .sort((a, b) => a.priceMonthly - b.priceMonthly);
          if (loaded.length > 0) setPlans(loaded);
        }
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
    setSubmittingEnquiry(true);
    try {
      const id = generateId('enq');
      await setDoc(doc(db, 'schoolEnquiries', id), {
        id,
        schoolName: enquiry.schoolName.trim().slice(0, 140),
        contactName: enquiry.contactName.trim().slice(0, 120),
        email: enquiry.email.trim().toLowerCase().slice(0, 160),
        phone: enquiry.phone.trim().slice(0, 32),
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

  const activePreview = PREVIEW_TABS.find((t) => t.id === previewTab) || PREVIEW_TABS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Sticky Top Navigation */}
      <header
        className={`sticky top-0 z-40 transition-all duration-150 border-b ${
          scrolled
            ? 'bg-white/95 backdrop-blur-sm border-slate-200 py-3'
            : 'bg-[#0B1528] border-slate-800/80 py-4'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <Link
            to="/"
            className={`text-lg font-extrabold font-display tracking-tight whitespace-nowrap shrink-0 ${
              scrolled ? 'text-[#0B1528]' : 'text-white'
            }`}
          >
            {settings.platformName || 'AcademiaOne'}
          </Link>

          {/* Zone 2: 5 Concise Single-line Nav Links */}
          <nav
            aria-label="Primary Navigation"
            className={`hidden lg:flex items-center gap-7 text-sm font-medium ${
              scrolled ? 'text-slate-600' : 'text-slate-300'
            }`}
          >
            <a href="#features" className="hover:text-teal-500 transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-teal-500 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#portals" className="hover:text-teal-500 transition-colors whitespace-nowrap shrink-0">
              For Schools
            </a>
            <a href="#plans" className="hover:text-teal-500 transition-colors whitespace-nowrap shrink-0">
              Plans
            </a>
            <a href="#contact" className="hover:text-teal-500 transition-colors whitespace-nowrap shrink-0">
              Contact
            </a>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="hidden lg:flex items-center gap-4 shrink-0">
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
                  className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    scrolled ? 'text-slate-600 hover:text-slate-900' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Track Application
                </Link>
                <Link
                  to="/login"
                  className={`text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    scrolled ? 'text-slate-700 hover:text-slate-900' : 'text-slate-200 hover:text-white'
                  }`}
                >
                  Sign In
                </Link>
                <Button variant="primary" size="sm" onClick={() => navigate('/register-school')}>
                  Register School
                </Button>
              </>
            )}
          </div>

          <button
            type="button"
            className={`lg:hidden p-2 rounded-lg ${scrolled ? 'text-slate-700' : 'text-white'}`}
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Responsive Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-t border-slate-200 px-6 py-5 space-y-4">
            <div className="flex flex-col gap-3 text-sm font-medium text-slate-700">
              <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
              <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
              <a href="#portals" onClick={() => setMobileMenuOpen(false)}>For Schools</a>
              <a href="#plans" onClick={() => setMobileMenuOpen(false)}>Plans</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
              <a href="#contact" onClick={() => setMobileMenuOpen(false)}>Contact</a>
              <Link to="/application-status" onClick={() => setMobileMenuOpen(false)} className="text-teal-700">
                Track Application Status
              </Link>
            </div>
            <div className="pt-3 border-t border-slate-100 flex items-center gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => navigate('/login')}>
                Sign In
              </Button>
              <Button variant="primary" className="flex-1" onClick={() => navigate('/register-school')}>
                Register School
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section: Deep Navy Architectural Canvas */}
      <section className="bg-[#0B1528] text-white relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(rgba(148,163,184,0.28) 1px, transparent 1px), radial-gradient(circle at 75% 20%, rgba(13,148,136,0.45), transparent 45%), radial-gradient(circle at 15% 80%, rgba(37,99,235,0.35), transparent 40%)',
            backgroundSize: '28px 28px, 100% 100%, 100% 100%',
          }}
        />
        <div className="max-w-7xl mx-auto px-6 py-20 lg:py-28 relative">
          <div className="grid lg:grid-cols-12 gap-12 items-stretch">
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="lg:col-span-6 flex flex-col justify-center"
            >
              <p className="text-xs font-medium text-teal-400 tracking-wide mb-4">
                Multi-School Academic Operations · Main Head Verified Onboarding · Strict Tenant Isolation
              </p>
              <h1
                className="font-display font-bold tracking-tight text-white text-balance leading-[1.1]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.6rem)' }}
              >
                One unified platform connecting school leadership, teachers, and students.
              </h1>
              <p className="mt-6 text-base text-slate-300 leading-relaxed max-w-xl">
                Submit your school registration for Main Head verification, receive your unique School
                Code upon approval, and onboard Coordinators, Teachers, and Students via Email &
                Password or Google Sign-In.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3.5">
                <Button variant="primary" size="lg" onClick={() => navigate('/register-school')}>
                  Register Your School
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  className="!bg-transparent !text-white !border-slate-600 hover:!bg-slate-800/80"
                  onClick={() => navigate(activeUser ? ROLE_HOME_ROUTES[activeUser.role] : '/login')}
                >
                  {activeUser ? 'Go to My Portal' : 'Sign In'}
                </Button>
                <Link
                  to="/application-status"
                  className="inline-flex items-center justify-center px-4 py-3 text-sm font-medium text-teal-300 hover:text-teal-200 transition-colors whitespace-nowrap"
                >
                  Track Application →
                </Link>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Public school applications are reviewed and approved by the Main Head before activating your campus workspace and Principal login.
              </p>
              <div className="mt-9 pt-8 border-t border-slate-800 grid grid-cols-3 gap-6">
                <div>
                  <p className="text-xl font-bold font-display tabular-nums text-white">5 Portals</p>
                  <p className="text-xs text-slate-400 mt-1">Email & Google auto-routing</p>
                </div>
                <div>
                  <p className="text-xl font-bold font-display tabular-nums text-white">100%</p>
                  <p className="text-xs text-slate-400 mt-1">schoolId rule isolation</p>
                </div>
                <div>
                  <p className="text-xl font-bold font-display tabular-nums text-white">Unique Code</p>
                  <p className="text-xs text-slate-400 mt-1">Auto-issued on approval</p>
                </div>
              </div>
            </motion.div>

            {/* Interactive Live Architecture Preview Card */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08 }}
              className="lg:col-span-6 flex"
            >
              <div className="w-full bg-[#111E36] border border-slate-700/80 rounded-2xl p-6 flex flex-col justify-between shadow-2xl">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
                    <div>
                      <p className="text-xs text-slate-400">Interactive Workspace Preview</p>
                      <p className="text-sm font-semibold text-white mt-0.5">{activePreview.headline}</p>
                    </div>
                  </div>

                  {/* Interactive Role Switcher inside Preview */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-4 p-1 bg-[#0B1528] rounded-lg border border-slate-800">
                    {PREVIEW_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPreviewTab(tab.id)}
                        className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          previewTab === tab.id
                            ? 'bg-teal-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-5">
                    {activePreview.metrics.map((m) => (
                      <div key={m.label} className="bg-[#0B1528]/90 border border-slate-800 rounded-lg p-3">
                        <p className="text-[11px] text-slate-400">{m.label}</p>
                        <p className="text-xs font-semibold text-teal-300 mt-1 tabular-nums">{m.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 border border-slate-800 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-4 bg-[#0B1528] px-3.5 py-2 text-[11px] font-medium text-slate-400">
                      {activePreview.columns.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                    <div className="divide-y divide-slate-800/80">
                      {activePreview.rows.map((r, i) => (
                        <div key={i} className="grid grid-cols-4 px-3.5 py-2.5 text-xs text-slate-200 items-center">
                          <span className="font-medium truncate pr-2">{r.col1}</span>
                          <span className="text-slate-400 truncate pr-2">{r.col2}</span>
                          <span className="text-teal-400 font-medium">{r.col3}</span>
                          <span className="text-slate-400 tabular-nums text-right">{r.col4}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <span>Demo sample preview · Live Firestore backend</span>
                  <Link to="/login" className="text-teal-400 hover:text-teal-300 font-medium">
                    Sign in to live portal →
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Core Capabilities — Editorial Asymmetric Grid */}
      <section id="features" className="max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-teal-700 tracking-wide">Platform Capabilities</p>
          <h2 className="mt-2 text-3xl font-bold font-display text-slate-900 tracking-tight text-balance">
            Structured school administration without fragmented spreadsheets
          </h2>
          <p className="mt-3 text-base text-slate-600 leading-relaxed">
            Every workflow is built around real institutional boundaries—preventing scheduling
            overlaps, enforcing marks limits, and preserving student histories across academic years.
          </p>
        </div>

        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              num: '01',
              icon: Building2,
              title: 'Multi-School Tenant Isolation',
              body: 'Every class, roster, attendance sheet, and result carries an enforced schoolId key verified in Firestore security rules.',
            },
            {
              num: '02',
              icon: ShieldCheck,
              title: 'Unified Role-Free Sign-In',
              body: 'One login form for every user. Credentials automatically resolve role, school scope, forced password resets, and subscription status.',
            },
            {
              num: '03',
              icon: CalendarClock,
              title: 'Conflict-Checked Timetables & Rooms',
              body: 'Detect teacher, class, and room double-bookings plus room capacity conflicts before publishing weekly or exam schedules.',
            },
            {
              num: '04',
              icon: ClipboardCheck,
              title: 'Audited Attendance & Bounded Marks',
              body: 'Teachers draft and submit daily attendance with change histories and enter exam marks validated strictly against maximum marks.',
            },
            {
              num: '05',
              icon: BookOpenCheck,
              title: 'Homework, Submissions & CSV Bulk Ops',
              body: 'Import students via validated CSV templates with duplicate detection, assign homework, collect files, and return inline teacher feedback.',
            },
            {
              num: '06',
              icon: BellRing,
              title: 'Push & In-App Notification Engine',
              body: 'Real-time alerts for new messages, task reminders, published exams, and special offers with per-user delivery preference controls.',
            },
          ].map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.num}
                className="bg-white border border-slate-200 rounded-xl p-6 transition-transform duration-150 hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-mono text-slate-400">{f.num}</span>
                  <Icon className="w-5 h-5 text-teal-600" />
                </div>
                <h3 className="text-base font-bold font-display text-slate-900">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Five Role-Based Portals */}
      <section id="portals" className="bg-white border-y border-slate-200 py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-teal-700 tracking-wide">Role-Based Portals</p>
            <h2 className="mt-2 text-3xl font-bold font-display text-slate-900 tracking-tight text-balance">
              Least-privilege workspaces tailored to every school role
            </h2>
          </div>

          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-5 gap-5">
            {[
              {
                role: 'Main Head',
                scope: 'Platform Owner',
                items: ['Register & govern schools', 'Provision Principal logins', 'Plans, renewals & billing', 'Platform analytics & audit log'],
              },
              {
                role: 'Principal',
                scope: 'Single School Admin',
                items: ['Coordinators & permissions', 'Teachers, students & CSV', 'Classes, rooms & timetables', 'Exams, notices & reports'],
              },
              {
                role: 'Coordinator',
                scope: 'Assigned Classes',
                items: ['Monitor attendance alerts', 'Review class timetables', 'Coordinate exam dates', 'Flag issues for Principal'],
              },
              {
                role: 'Teacher',
                scope: 'Assigned Subjects',
                items: ['Daily classes & agenda', 'Draft/submit attendance', 'Homework & marks entry', 'Upload learning materials'],
              },
              {
                role: 'Student',
                scope: 'Personal Portal',
                items: ['Weekly class timetable', 'Online homework upload', 'Published exam results', 'Attendance & resources'],
              },
            ].map((p) => (
              <div key={p.role} className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col">
                <p className="text-xs text-teal-700 font-medium">{p.scope}</p>
                <h3 className="text-base font-bold font-display text-slate-900 mt-1">{p.role}</h3>
                <ul className="mt-4 space-y-2 text-xs text-slate-600 flex-1">
                  {p.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How Onboarding Works */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-24">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold text-teal-700 tracking-wide">Onboarding Workflow</p>
          <h2 className="mt-2 text-3xl font-bold font-display text-slate-900 tracking-tight text-balance">
            From school registration to live classrooms in four structured steps
          </h2>
        </div>

        <div className="mt-12 grid md:grid-cols-4 gap-6">
          {[
            { step: '01', title: '7-Step Application', desc: 'Schools submit official institutional, Principal, academic, and plan details and receive a trackable Application Number.' },
            { step: '02', title: 'Main Head Approval', desc: 'Main Head verifies the application and auto-issues a unique School Code while enabling Principal Email & Google login.' },
            { step: '03', title: 'Post-Approval Setup', desc: 'Principal configures classes, separate sections per class, exam/campus rooms, and registers staff & student email IDs.' },
            { step: '04', title: 'Smart Member Access', desc: 'Registered emails enter directly on sign-in; unregistered members enter the School Code to apply to the Principal.' },
          ].map((item) => (
            <div key={item.step} className="bg-white border border-slate-200 rounded-xl p-6">
              <p className="text-2xl font-bold font-mono text-teal-600 tabular-nums">{item.step}</p>
              <h3 className="mt-3 text-base font-bold font-display text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Subscription Plans */}
      <section id="plans" className="bg-white border-y border-slate-200 py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-teal-700 tracking-wide">Subscription Plans</p>
            <h2 className="mt-2 text-3xl font-bold font-display text-slate-900 tracking-tight text-balance">
              Transparent capacity tiers managed centrally by the platform owner
            </h2>
          </div>

          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {plans.map((plan) => {
              const featured = plan.tier === 'standard';
              return (
                <div
                  key={plan.id}
                  className={`rounded-xl p-6 flex flex-col justify-between border ${
                    featured
                      ? 'bg-[#0B1528] text-white border-[#0B1528]'
                      : 'bg-slate-50 text-slate-900 border-slate-200'
                  }`}
                >
                  <div>
                    <p className={`text-xs font-medium ${featured ? 'text-teal-400' : 'text-teal-700'}`}>
                      {plan.billingInterval === 'annual' ? 'Annual Billing' : 'Monthly Billing'}
                    </p>
                    <h3 className="mt-1 text-lg font-bold font-display">{plan.name}</h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-bold font-display tabular-nums">
                        ${plan.priceMonthly}
                      </span>
                      <span className={`text-xs ${featured ? 'text-slate-400' : 'text-slate-500'}`}>/month</span>
                    </div>
                    <p className={`mt-3 text-xs leading-relaxed ${featured ? 'text-slate-300' : 'text-slate-600'}`}>
                      {plan.description}
                    </p>

                    <div className={`mt-5 pt-5 border-t space-y-2 text-xs tabular-nums ${featured ? 'border-slate-800 text-slate-200' : 'border-slate-200 text-slate-700'}`}>
                      <div className="flex justify-between">
                        <span className={featured ? 'text-slate-400' : 'text-slate-500'}>Student Capacity</span>
                        <span className="font-semibold">{plan.maxStudents.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={featured ? 'text-slate-400' : 'text-slate-500'}>Teacher Capacity</span>
                        <span className="font-semibold">{plan.maxTeachers.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={featured ? 'text-slate-400' : 'text-slate-500'}>Storage Allocation</span>
                        <span className="font-semibold">{plan.storageGb} GB</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <Link
                      to={`/register-school?plan=${encodeURIComponent(plan.id)}`}
                      className={`w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                        featured
                          ? 'bg-teal-600 text-white hover:bg-teal-500'
                          : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Register With This Plan
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ + School Registration Enquiry & Contact */}
      <section id="faq" className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-12 gap-14 items-start">
          {/* FAQ Column */}
          <div className="lg:col-span-5">
            <p className="text-xs font-semibold text-teal-700 tracking-wide">Frequently Asked Questions</p>
            <h2 className="mt-2 text-2xl font-bold font-display text-slate-900 tracking-tight">
              Security, access & onboarding answers
            </h2>
            <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
              {FAQS.map((item, idx) => (
                <div key={item.q} className="py-4">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left text-sm font-semibold text-slate-900 cursor-pointer"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                        openFaq === idx ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {openFaq === idx && (
                    <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">{item.a}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 space-y-2.5 text-sm text-slate-600">
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-teal-600" />
                <span>{settings.supportEmail || 'support@academiaone.edu'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-teal-600" />
                <span>{settings.supportPhone || '+1 (800) 555-0199'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4 text-teal-600" />
                <span>Multi-Region Cloud Platform · HTTPS Enforced</span>
              </div>
            </div>
          </div>

          {/* School Registration Enquiry Form */}
          <div id="contact" className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-8">
            <h3 className="text-xl font-bold font-display text-slate-900">
              School Registration & Onboarding Enquiry
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Register interest for your institution. Submissions route directly to the Main Head dashboard.
            </p>

            {settings.allowPublicRegistration === false ? (
              <div className="mt-6 p-5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
                Public school self-enquiries are currently paused by the platform administrator. Please contact{' '}
                <span className="font-semibold text-slate-900">{settings.supportEmail}</span> directly.
              </div>
            ) : enquirySubmitted ? (
              <div className="mt-6 p-6 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm font-semibold text-emerald-900">Enquiry received</p>
                <p className="text-sm text-emerald-800 mt-1">
                  Thank you. Your school registration request has been logged for review by the Main Head team.
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
              <form onSubmit={handleEnquirySubmit} className="mt-6 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">School Name *</label>
                    <input
                      type="text"
                      required
                      value={enquiry.schoolName}
                      onChange={(e) => setEnquiry({ ...enquiry, schoolName: e.target.value })}
                      placeholder="e.g. Oakwood Science Academy"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Contact Person *</label>
                    <input
                      type="text"
                      required
                      value={enquiry.contactName}
                      onChange={(e) => setEnquiry({ ...enquiry, contactName: e.target.value })}
                      placeholder="e.g. Dr. Miriam Alcott"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
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
                      placeholder="principal@school.edu"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={enquiry.phone}
                      onChange={(e) => setEnquiry({ ...enquiry, phone: e.target.value })}
                      placeholder="+1 (555) 012-3456"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
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
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:border-teal-600"
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
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-teal-600"
                  />
                </div>

                {enquiryError && <p className="text-xs text-red-600">{enquiryError}</p>}

                <div className="flex items-center justify-end">
                  <Button type="submit" variant="navy" disabled={submittingEnquiry}>
                    {submittingEnquiry ? 'Submitting…' : 'Submit School Enquiry'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="bg-[#0B1528] text-slate-400 border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <p className="text-base font-bold font-display text-white">
              {settings.platformName || 'AcademiaOne'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Multi-School Management Platform · Strict Tenant Isolation
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-xs">
            <Link to="/register-school" className="text-teal-400 hover:text-teal-300 font-medium transition-colors">Register School</Link>
            <Link to="/application-status" className="hover:text-white transition-colors">Track Application</Link>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#plans" className="hover:text-white transition-colors">Plans</a>
            <Link to="/login" className="hover:text-white transition-colors">Sign In</Link>
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

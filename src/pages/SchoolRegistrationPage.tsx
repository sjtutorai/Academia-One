import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Mail,
  MapPin,
  Save,
  ShieldCheck,
  Upload,
  UserCheck,
  BookOpen,
  CreditCard,
} from 'lucide-react';
import { collection, doc, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, generateId } from '../lib/firebase';
import { generateApplicationNumber, hashVerificationEmail } from '../lib/schoolProvisioning';
import { Button, useToast } from '../components/ui/Primitives';
import type { SubscriptionPlan } from '../types/models';

const DRAFT_STORAGE_KEY = 'academiaone_school_reg_draft_v1';
const POLICY_VERSION = '2026.11';

const STEP_META = [
  { id: 1, title: 'Applicant & Verification', short: 'Applicant', icon: UserCheck },
  { id: 2, title: 'School Basic Information', short: 'School Info', icon: Building2 },
  { id: 3, title: 'Address & Contact', short: 'Address', icon: MapPin },
  { id: 4, title: 'Principal & Login Method', short: 'Principal', icon: Mail },
  { id: 5, title: 'Academic Profile', short: 'Academics', icon: BookOpen },
  { id: 6, title: 'Preferred Subscription', short: 'Plan', icon: CreditCard },
  { id: 7, title: 'Review & Submit', short: 'Review', icon: ShieldCheck },
] as const;

interface RegistrationDraft {
  // Step 1
  applicantName: string;
  applicantDesignation: string;
  applicantEmail: string;
  applicantPhone: string;
  organizationName: string;
  preferredContactMethod: string;
  authorityRelationship: string;
  contactConsent: boolean;
  contactVerified: boolean;
  // Step 2
  schoolName: string;
  displayName: string;
  institutionType: string;
  affiliationBoard: string;
  mediumOfInstruction: string;
  establishedYear: string;
  website: string;
  externalRecognitionCode: string;
  logoDataUrl: string;
  logoFileName: string;
  // Step 3
  country: string;
  stateRegion: string;
  district: string;
  city: string;
  postalCode: string;
  address: string;
  schoolPhone: string;
  schoolEmail: string;
  alternateContact: string;
  campusAddress: string;
  // Step 4
  applicantIsPrincipal: boolean;
  principalName: string;
  principalDesignation: string;
  principalEmail: string;
  principalPhone: string;
  authMethod: 'email_password' | 'google';
  // Step 5
  academicYear: string;
  classesOffered: string;
  estimatedStudents: string;
  estimatedTeachers: string;
  workingDaysSummary: string;
  // Step 6
  requestedPlanId: string;
  // Step 7
  acceptedTerms: boolean;
}

const INITIAL_DRAFT: RegistrationDraft = {
  applicantName: '',
  applicantDesignation: 'Principal',
  applicantEmail: '',
  applicantPhone: '',
  organizationName: '',
  preferredContactMethod: 'Email',
  authorityRelationship: '',
  contactConsent: false,
  contactVerified: false,
  schoolName: '',
  displayName: '',
  institutionType: 'Private',
  affiliationBoard: 'CBSE',
  mediumOfInstruction: 'English',
  establishedYear: '',
  website: '',
  externalRecognitionCode: '',
  logoDataUrl: '',
  logoFileName: '',
  country: 'United States',
  stateRegion: '',
  district: '',
  city: '',
  postalCode: '',
  address: '',
  schoolPhone: '',
  schoolEmail: '',
  alternateContact: '',
  campusAddress: '',
  applicantIsPrincipal: true,
  principalName: '',
  principalDesignation: 'Principal',
  principalEmail: '',
  principalPhone: '',
  authMethod: 'google',
  academicYear: '2026-2027',
  classesOffered: 'Grades 1 to 12',
  estimatedStudents: '400',
  estimatedTeachers: '30',
  workingDaysSummary: 'Monday to Friday',
  requestedPlanId: 'plan_standard',
  acceptedTerms: false,
};

const FALLBACK_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan_free',
    name: 'Free Starter',
    tier: 'free',
    priceMonthly: 0,
    billingInterval: 'monthly',
    trialDays: 0,
    maxStudents: 100,
    maxTeachers: 12,
    storageGb: 5,
    enabledModules: ['attendance', 'timetable', 'announcements'],
    status: 'active',
    description: 'For small academies piloting structured attendance and schedules.',
  },
  {
    id: 'plan_basic',
    name: 'Basic Campus',
    tier: 'basic',
    priceMonthly: 99,
    billingInterval: 'monthly',
    trialDays: 14,
    maxStudents: 500,
    maxTeachers: 45,
    storageGb: 25,
    enabledModules: ['attendance', 'timetable', 'homework', 'exams', 'announcements'],
    status: 'active',
    description: 'Essential academic management for growing single-campus schools.',
  },
  {
    id: 'plan_standard',
    name: 'Standard Academy',
    tier: 'standard',
    priceMonthly: 249,
    billingInterval: 'monthly',
    trialDays: 14,
    maxStudents: 1500,
    maxTeachers: 120,
    storageGb: 100,
    enabledModules: ['attendance', 'timetable', 'homework', 'exams', 'materials', 'reports', 'csv_bulk'],
    status: 'active',
    description: 'Complete multi-role academic operations with CSV import and analytics.',
  },
  {
    id: 'plan_premium',
    name: 'Premium Institution',
    tier: 'premium',
    priceMonthly: 499,
    billingInterval: 'monthly',
    trialDays: 30,
    maxStudents: 5000,
    maxTeachers: 400,
    storageGb: 500,
    enabledModules: ['attendance', 'timetable', 'homework', 'exams', 'materials', 'reports', 'csv_bulk', 'audit_logs'],
    status: 'active',
    description: 'Enterprise-scale campus capacity, priority onboarding, and audit trails.',
  },
];

export default function SchoolRegistrationPage() {
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<RegistrationDraft>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) return { ...INITIAL_DRAFT, ...JSON.parse(saved) };
    } catch {
      // ignore corrupted localStorage
    }
    return INITIAL_DRAFT;
  });
  const [plans, setPlans] = useState<SubscriptionPlan[]>(FALLBACK_PLANS);
  const [stepError, setStepError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<{
    applicationNumber: string;
    schoolName: string;
    principalEmail: string;
    applicantEmail: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    getDocs(collection(db, 'subscriptionPlans'))
      .then((snap) => {
        if (!active || snap.empty) return;
        const loaded = snap.docs
          .map((d) => d.data() as SubscriptionPlan)
          .filter((p) => p.status === 'active')
          .sort((a, b) => a.priceMonthly - b.priceMonthly);
        if (loaded.length > 0) {
          setPlans(loaded);
          setDraft((prev) =>
            loaded.some((p) => p.id === prev.requestedPlanId)
              ? prev
              : { ...prev, requestedPlanId: loaded[Math.min(2, loaded.length - 1)].id },
          );
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const updateField = <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setStepError('');
  };

  const handleSaveDraft = () => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      pushToast('success', 'Application draft saved locally. You can resume anytime on this browser.');
    } catch {
      pushToast('warning', 'Draft could not be saved locally (storage limit reached).');
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setStepError('Logo must be a PNG, JPG, or WEBP image.');
      return;
    }
    if (file.size > 120 * 1024) {
      setStepError('Please upload a compact school logo under 120 KB for fast verification.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      updateField('logoDataUrl', result);
      updateField('logoFileName', file.name);
    };
    reader.readAsDataURL(file);
  };

  const validateStep = (targetStep: number): string | null => {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (targetStep === 1) {
      if (draft.applicantName.trim().length < 2) return 'Enter the applicant full name (at least 2 characters).';
      if (!emailRe.test(draft.applicantEmail.trim())) return 'Enter a valid official applicant email address.';
      if (draft.applicantPhone.trim().length < 7) return 'Enter a valid applicant mobile number.';
      if (draft.applicantDesignation !== 'Principal' && draft.authorityRelationship.trim().length < 2) {
        return 'Specify your relationship or authority to register on behalf of the school.';
      }
      if (!draft.contactVerified) return 'Confirm your contact email/mobile verification check before continuing.';
      if (!draft.contactConsent) return 'Accept contact consent and the privacy notice to proceed.';
    }
    if (targetStep === 2) {
      if (draft.schoolName.trim().length < 2) return 'Enter the official registered school name.';
      if (!draft.institutionType) return 'Select the school type.';
      if (!draft.affiliationBoard) return 'Select the education board or affiliation.';
    }
    if (targetStep === 3) {
      if (draft.country.trim().length < 2 || draft.city.trim().length < 2) return 'Enter country and city/town.';
      if (draft.address.trim().length < 5) return 'Enter the full registered school address.';
      if (!emailRe.test(draft.schoolEmail.trim())) return 'Enter a valid official school email address.';
      if (draft.schoolPhone.trim().length < 7) return 'Enter an official school phone number.';
    }
    if (targetStep === 4) {
      const pName = draft.applicantIsPrincipal ? draft.applicantName : draft.principalName;
      const pEmail = draft.applicantIsPrincipal ? draft.applicantEmail : draft.principalEmail;
      if (pName.trim().length < 2) return 'Enter the Principal full name.';
      if (!emailRe.test(pEmail.trim())) return 'Enter a valid official Principal email ID.';
    }
    if (targetStep === 5) {
      if (draft.academicYear.trim().length < 4) return 'Enter the current academic year (e.g., 2026-2027).';
    }
    if (targetStep === 6) {
      if (!draft.requestedPlanId) return 'Select a preferred subscription plan.';
    }
    if (targetStep === 7) {
      if (!draft.acceptedTerms) return 'You must accept the Terms of Service and Privacy Policy before submitting.';
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    if (step === 1 && draft.applicantIsPrincipal) {
      setDraft((prev) => ({
        ...prev,
        principalName: prev.principalName || prev.applicantName,
        principalEmail: prev.principalEmail || prev.applicantEmail,
        principalPhone: prev.principalPhone || prev.applicantPhone,
      }));
    }
    setStep((s) => Math.min(7, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goBack = () => {
    setStepError('');
    setStep((s) => Math.max(1, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFinalSubmit = async () => {
    for (let i = 1; i <= 7; i++) {
      const err = validateStep(i);
      if (err) {
        setStep(i);
        setStepError(err);
        return;
      }
    }

    setSubmitting(true);
    setStepError('');

    const applicationId = generateId('app');
    const applicationNumber = generateApplicationNumber('SCH');
    const effectivePrincipalName = (draft.applicantIsPrincipal ? draft.applicantName : draft.principalName).trim();
    const effectivePrincipalEmail = (draft.applicantIsPrincipal ? draft.applicantEmail : draft.principalEmail)
      .trim()
      .toLowerCase();
    const effectivePrincipalPhone = (draft.applicantIsPrincipal ? draft.applicantPhone : draft.principalPhone).trim();
    const submittedIso = new Date().toISOString();

    try {
      const verificationEmailHash = await hashVerificationEmail(draft.applicantEmail);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      batch.set(doc(db, 'schoolApplications', applicationId), {
        id: applicationId,
        applicationNumber,
        applicantName: draft.applicantName.trim().slice(0, 120),
        applicantDesignation: draft.applicantDesignation.slice(0, 64),
        applicantEmail: draft.applicantEmail.trim().toLowerCase().slice(0, 160),
        applicantPhone: draft.applicantPhone.trim().slice(0, 32),
        organizationName: draft.organizationName.trim().slice(0, 140),
        preferredContactMethod: draft.preferredContactMethod.slice(0, 32),
        authorityRelationship: draft.authorityRelationship.trim().slice(0, 140),
        applicantIsPrincipal: draft.applicantIsPrincipal,
        contactVerified: draft.contactVerified,
        schoolName: draft.schoolName.trim().slice(0, 140),
        displayName: (draft.displayName.trim() || draft.schoolName.trim()).slice(0, 140),
        institutionType: draft.institutionType.slice(0, 64),
        affiliationBoard: draft.affiliationBoard.slice(0, 120),
        mediumOfInstruction: draft.mediumOfInstruction.trim().slice(0, 120),
        establishedYear: draft.establishedYear.trim().slice(0, 16),
        externalRecognitionCode: draft.externalRecognitionCode.trim().slice(0, 64),
        logoDataUrl: draft.logoDataUrl.slice(0, 200000),
        academicYear: draft.academicYear.trim().slice(0, 24),
        website: draft.website.trim().slice(0, 200),
        schoolEmail: draft.schoolEmail.trim().toLowerCase().slice(0, 160),
        schoolPhone: draft.schoolPhone.trim().slice(0, 32),
        alternateContact: draft.alternateContact.trim().slice(0, 120),
        country: draft.country.trim().slice(0, 80),
        stateRegion: draft.stateRegion.trim().slice(0, 80),
        district: draft.district.trim().slice(0, 80),
        city: draft.city.trim().slice(0, 80),
        postalCode: draft.postalCode.trim().slice(0, 24),
        address: draft.address.trim().slice(0, 300),
        campusAddress: draft.campusAddress.trim().slice(0, 300),
        classesOffered: draft.classesOffered.trim().slice(0, 200),
        estimatedStudents: Number(draft.estimatedStudents) || 0,
        estimatedTeachers: Number(draft.estimatedTeachers) || 0,
        workingDaysSummary: draft.workingDaysSummary.trim().slice(0, 120),
        principalName: effectivePrincipalName.slice(0, 120),
        principalEmail: effectivePrincipalEmail.slice(0, 160),
        principalPhone: effectivePrincipalPhone.slice(0, 32),
        principalDesignation: (draft.principalDesignation || 'Principal').trim().slice(0, 120),
        authMethod: draft.authMethod,
        requestedPlanId: draft.requestedPlanId,
        consentPolicyVersion: POLICY_VERSION,
        status: 'submitted',
        internalNotes: '',
        applicantMessage: 'Your school application has been received and queued for Main Head review.',
        decisionNote: '',
        approvedSchoolId: '',
        approvedSchoolCode: '',
        reviewedBy: '',
        activityLog: [
          {
            at: submittedIso,
            actor: draft.applicantName.trim(),
            action: 'APPLICATION_SUBMITTED',
            note: `Submitted 7-step registration (${draft.authMethod === 'google' ? 'Google' : 'Email & Password'} preferred).`,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });

      batch.set(doc(db, 'applicationStatuses', applicationNumber), {
        applicationNumber,
        type: 'school',
        verificationEmailHash,
        schoolId: '',
        schoolName: draft.schoolName.trim().slice(0, 140),
        requestedRole: 'principal',
        status: 'submitted',
        schoolCode: '',
        applicantMessage: 'Application received. Our Main Head administrator will review your school details shortly.',
        decisionNote: '',
        applicantResponseNote: '',
        submittedAt: submittedIso,
        createdAt: now,
        updatedAt: now,
      });

      await batch.commit();
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setSubmittedRef({
        applicationNumber,
        schoolName: draft.schoolName.trim(),
        principalEmail: effectivePrincipalEmail,
        applicantEmail: draft.applicantEmail.trim().toLowerCase(),
      });
      pushToast('success', `School application ${applicationNumber} submitted for Main Head review.`);
    } catch (err) {
      setStepError(
        err instanceof Error
          ? `Submission failed: ${err.message}`
          : 'Unable to submit school application right now. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPlan = plans.find((p) => p.id === draft.requestedPlanId) || plans[0];
  const effectivePrincipalName = draft.applicantIsPrincipal ? draft.applicantName : draft.principalName;
  const effectivePrincipalEmail = draft.applicantIsPrincipal ? draft.applicantEmail : draft.principalEmail;
  const effectivePrincipalPhone = draft.applicantIsPrincipal ? draft.applicantPhone : draft.principalPhone;

  if (submittedRef) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
          className="max-w-xl w-full mx-auto bg-white border border-slate-200 rounded-xl p-8"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mb-5">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <p className="text-xs font-semibold text-teal-700">Application Submitted · Pending Main Head Review</p>
          <h1 className="text-2xl font-bold font-display text-slate-900 mt-1">
            {submittedRef.schoolName} application received
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Your school tenant is not active yet. Once the Main Head approves your application, a unique{' '}
            <strong>School Code</strong> will be auto-generated and Principal access for{' '}
            <span className="font-mono text-xs text-slate-800">{submittedRef.principalEmail}</span> will be activated
            (supporting both Email/Password and Google Sign-In).
          </p>

          <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Your Unique Application Number</p>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <span className="text-xl font-bold font-mono tabular-nums tracking-wider text-[#0B1528]">
                {submittedRef.applicationNumber}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(submittedRef.applicationNumber);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Save this reference number. Use it alongside <span className="font-mono">{submittedRef.applicantEmail}</span>{' '}
              on the Track Application page to check review progress and retrieve your School Code once approved.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to={`/application-status?ref=${encodeURIComponent(submittedRef.applicationNumber)}`}>
              <Button variant="primary">Track Application Status</Button>
            </Link>
            <Link to="/">
              <Button variant="secondary">Return to Home</Button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Top Bar */}
      <header className="bg-[#0B1528] text-white border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="font-display font-extrabold text-lg tracking-tight">
              AcademiaOne
            </Link>
            <span className="text-slate-600 hidden sm:inline">/</span>
            <span className="text-xs text-slate-300 hidden sm:inline">School Registration Application</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/application-status" className="text-teal-300 hover:text-teal-200 font-medium">
              Track Application
            </Link>
            <Link to="/login" className="text-slate-300 hover:text-white font-medium">
              Sign In
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to AcademiaOne
            </Link>
            <h1 className="text-2xl font-bold font-display text-slate-900 mt-1">Register Your School</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Complete all 7 steps to submit your school for Main Head verification. Full classes, sections, rooms, and
              student emails are configured in your Campus Setup Wizard immediately after approval.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleSaveDraft}>
            <Save className="w-3.5 h-3.5" /> Save Draft
          </Button>
        </div>

        {/* Stepper & Progress Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between text-xs mb-2.5">
            <span className="font-semibold text-slate-900">
              Step {step} of 7 · {STEP_META[step - 1].title}
            </span>
            <span className="text-slate-500 tabular-nums">{Math.round((step / 7) * 100)}% complete</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-teal-600 rounded-full"
              initial={false}
              animate={{ width: `${(step / 7) * 100}%` }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.25 }}
            />
          </div>
          <div className="grid grid-cols-7 gap-1.5 mt-4">
            {STEP_META.map((s) => {
              const done = s.id < step;
              const current = s.id === step;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (s.id < step) {
                      setStepError('');
                      setStep(s.id);
                    }
                  }}
                  disabled={s.id > step}
                  className={`text-left px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors truncate ${
                    current
                      ? 'bg-[#0B1528] text-white'
                      : done
                        ? 'bg-teal-50 text-teal-800 hover:bg-teal-100 cursor-pointer'
                        : 'text-slate-400 bg-slate-50 cursor-not-allowed'
                  }`}
                >
                  {s.id}. {s.short}
                </button>
              );
            })}
          </div>
        </div>

        {/* Animated Step Body */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={prefersReducedMotion ? false : { opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, x: -10 }}
              transition={{ duration: 0.18 }}
              className="space-y-5"
            >
              {/* STEP 1 */}
              {step === 1 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 1 — Applicant Account & Verification
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Tell us who is submitting this registration and verify a reliable contact channel.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Applicant Full Name *</label>
                      <input
                        value={draft.applicantName}
                        onChange={(e) => updateField('applicantName', e.target.value)}
                        placeholder="Dr. Eleanor Vance"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Designation *</label>
                      <select
                        value={draft.applicantDesignation}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateField('applicantDesignation', val);
                          updateField('applicantIsPrincipal', val === 'Principal');
                        }}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      >
                        <option value="Principal">Principal</option>
                        <option value="School Owner">School Owner</option>
                        <option value="Director">Director</option>
                        <option value="Authorized Representative">Authorized Representative</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Official Email Address *</label>
                      <input
                        type="email"
                        value={draft.applicantEmail}
                        onChange={(e) => updateField('applicantEmail', e.target.value)}
                        placeholder="principal@school.edu"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile Number *</label>
                      <input
                        type="tel"
                        value={draft.applicantPhone}
                        onChange={(e) => updateField('applicantPhone', e.target.value)}
                        placeholder="+1 (555) 234-5678"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Management / Trust / Organization (Optional)
                      </label>
                      <input
                        value={draft.organizationName}
                        onChange={(e) => updateField('organizationName', e.target.value)}
                        placeholder="Northridge Education Trust"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Preferred Contact Channel</label>
                      <select
                        value={draft.preferredContactMethod}
                        onChange={(e) => updateField('preferredContactMethod', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      >
                        <option value="Email">Official Email</option>
                        <option value="Phone">Mobile Phone</option>
                        <option value="Both">Both Email & Phone</option>
                      </select>
                    </div>
                  </div>

                  {draft.applicantDesignation !== 'Principal' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Authority / Relationship to School *
                      </label>
                      <input
                        value={draft.authorityRelationship}
                        onChange={(e) => updateField('authorityRelationship', e.target.value)}
                        placeholder="e.g., Managing Trustee authorized by School Board"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                  )}

                  <div className="pt-2 space-y-2.5 border-t border-slate-100">
                    <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.contactVerified}
                        onChange={(e) => updateField('contactVerified', e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-teal-600"
                      />
                      <span>
                        I verify that <strong>{draft.applicantEmail || 'my email address'}</strong> and{' '}
                        <strong>{draft.applicantPhone || 'mobile number'}</strong> are active official channels for
                        receiving review notices and application tracking verification.
                      </span>
                    </label>
                    <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.contactConsent}
                        onChange={(e) => updateField('contactConsent', e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-teal-600"
                      />
                      <span>
                        I consent to AcademiaOne contacting me regarding this school registration and accept the{' '}
                        <Link to="/privacy" target="_blank" className="text-teal-700 underline">
                          Privacy Policy
                        </Link>
                        .
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* STEP 2 */}
              {step === 2 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 2 — School Basic Information
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Provide institutional identity details. Your platform School Code will be auto-generated upon Main
                      Head approval.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Official Registered School Name *
                      </label>
                      <input
                        value={draft.schoolName}
                        onChange={(e) => updateField('schoolName', e.target.value)}
                        placeholder="St. Xavier Preparatory Academy"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Display Name (Optional)</label>
                      <input
                        value={draft.displayName}
                        onChange={(e) => updateField('displayName', e.target.value)}
                        placeholder="St. Xavier Prep"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">School Type *</label>
                      <select
                        value={draft.institutionType}
                        onChange={(e) => updateField('institutionType', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      >
                        <option value="Private">Private</option>
                        <option value="Government">Government</option>
                        <option value="Aided">Aided</option>
                        <option value="International">International</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Board / Affiliation *</label>
                      <select
                        value={draft.affiliationBoard}
                        onChange={(e) => updateField('affiliationBoard', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      >
                        <option value="CBSE">CBSE</option>
                        <option value="ICSE">ICSE</option>
                        <option value="State Board">State Board</option>
                        <option value="IB">International Baccalaureate (IB)</option>
                        <option value="Cambridge / IGCSE">Cambridge / IGCSE</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Medium(s) of Instruction</label>
                      <input
                        value={draft.mediumOfInstruction}
                        onChange={(e) => updateField('mediumOfInstruction', e.target.value)}
                        placeholder="English, Bilingual"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Establishment Year</label>
                      <input
                        value={draft.establishedYear}
                        onChange={(e) => updateField('establishedYear', e.target.value)}
                        placeholder="1998"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">School Website (Optional)</label>
                      <input
                        value={draft.website}
                        onChange={(e) => updateField('website', e.target.value)}
                        placeholder="https://school.edu"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Government / Board Recognition Number (Optional)
                      </label>
                      <input
                        value={draft.externalRecognitionCode}
                        onChange={(e) => updateField('externalRecognitionCode', e.target.value)}
                        placeholder="External affiliation number"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                  </div>

                  {/* Logo Upload Zone */}
                  <div className="border border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/70 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {draft.logoDataUrl ? (
                        <img
                          src={draft.logoDataUrl}
                          alt="School logo preview"
                          className="w-12 h-12 rounded-lg object-cover border border-slate-200 bg-white"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                          <Upload className="w-5 h-5" />
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          {draft.logoFileName ? `Uploaded: ${draft.logoFileName}` : 'School Crest / Logo (Optional)'}
                        </p>
                        <p className="text-[11px] text-slate-500">PNG, JPG, or WEBP up to 120 KB</p>
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      {draft.logoDataUrl ? 'Replace Logo' : 'Upload Logo'}
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" />
                    </label>
                  </div>
                </>
              )}

              {/* STEP 3 */}
              {step === 3 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 3 — School Address & Official Contact
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Registered institutional location and administrative contact information.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Country *</label>
                      <input
                        value={draft.country}
                        onChange={(e) => updateField('country', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">State / Province *</label>
                      <input
                        value={draft.stateRegion}
                        onChange={(e) => updateField('stateRegion', e.target.value)}
                        placeholder="California / Karnataka"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">District / County</label>
                      <input
                        value={draft.district}
                        onChange={(e) => updateField('district', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">City / Town *</label>
                        <input
                          value={draft.city}
                          onChange={(e) => updateField('city', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">PIN / Postal Code</label>
                        <input
                          value={draft.postalCode}
                          onChange={(e) => updateField('postalCode', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Full Registered Address *</label>
                      <input
                        value={draft.address}
                        onChange={(e) => updateField('address', e.target.value)}
                        placeholder="420 Oakridge Boulevard, North Wing"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Official School Email *</label>
                      <input
                        type="email"
                        value={draft.schoolEmail}
                        onChange={(e) => updateField('schoolEmail', e.target.value)}
                        placeholder="office@school.edu"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Official School Phone *</label>
                      <input
                        type="tel"
                        value={draft.schoolPhone}
                        onChange={(e) => updateField('schoolPhone', e.target.value)}
                        placeholder="+1 (555) 890-1200"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Alternate Contact (Optional)</label>
                      <input
                        value={draft.alternateContact}
                        onChange={(e) => updateField('alternateContact', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Separate Campus Address (If Different)
                      </label>
                      <input
                        value={draft.campusAddress}
                        onChange={(e) => updateField('campusAddress', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* STEP 4 */}
              {step === 4 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 4 — Principal Details & Login Method
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      No active Principal account is created on submission. Once Main Head approves your school, this
                      Principal email can sign in via either Email & Password or Google.
                    </p>
                  </div>

                  <label className="flex items-center gap-2.5 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.applicantIsPrincipal}
                      onChange={(e) => updateField('applicantIsPrincipal', e.target.checked)}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    The applicant ({draft.applicantName || 'Step 1'}) is also the School Principal
                  </label>

                  {!draft.applicantIsPrincipal && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Principal Full Name *</label>
                        <input
                          value={draft.principalName}
                          onChange={(e) => updateField('principalName', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Designation</label>
                        <input
                          value={draft.principalDesignation}
                          onChange={(e) => updateField('principalDesignation', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Principal Official Email *</label>
                        <input
                          type="email"
                          value={draft.principalEmail}
                          onChange={(e) => updateField('principalEmail', e.target.value)}
                          placeholder="principal@school.edu"
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Principal Mobile Number</label>
                        <input
                          type="tel"
                          value={draft.principalPhone}
                          onChange={(e) => updateField('principalPhone', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    <p className="text-xs font-semibold text-slate-700 mb-2.5">
                      Preferred Principal Sign-In Method After Approval *
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(
                        [
                          {
                            id: 'google',
                            title: 'Continue with Google',
                            desc: 'Sign in instantly with your verified Google Workspace or Gmail account once approved.',
                          },
                          {
                            id: 'email_password',
                            title: 'Email & Password',
                            desc: 'Sign up or log in with your registered Principal email and private password once approved.',
                          },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateField('authMethod', opt.id)}
                          className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                            draft.authMethod === opt.id
                              ? 'border-teal-600 bg-teal-50/40'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <p className="text-sm font-semibold text-slate-900">{opt.title}</p>
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{opt.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* STEP 5 */}
              {step === 5 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">Step 5 — Academic Profile</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Provide high-level estimates now. Detailed classes, separate sections, exam rooms, and staff/student
                      email lists are set up by your Principal right after Main Head approval.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Current Academic Year *</label>
                      <input
                        value={draft.academicYear}
                        onChange={(e) => updateField('academicYear', e.target.value)}
                        placeholder="2026-2027"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Working Days</label>
                      <input
                        value={draft.workingDaysSummary}
                        onChange={(e) => updateField('workingDaysSummary', e.target.value)}
                        placeholder="Monday to Friday"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Approximate Grades / Classes Offered
                      </label>
                      <input
                        value={draft.classesOffered}
                        onChange={(e) => updateField('classesOffered', e.target.value)}
                        placeholder="Grades 1–12 with Sections A, B, C"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Approximate Students</label>
                      <input
                        type="number"
                        min={1}
                        value={draft.estimatedStudents}
                        onChange={(e) => updateField('estimatedStudents', e.target.value)}
                        className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Approximate Teachers</label>
                      <input
                        type="number"
                        min={1}
                        value={draft.estimatedTeachers}
                        onChange={(e) => updateField('estimatedTeachers', e.target.value)}
                        className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* STEP 6 */}
              {step === 6 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 6 — Preferred Subscription Plan
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Choose your preferred institutional tier. Main Head confirms the final plan, limits, and trial
                      period upon approval.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {plans.map((plan) => {
                      const active = draft.requestedPlanId === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => updateField('requestedPlanId', plan.id)}
                          className={`text-left p-5 rounded-xl border transition-colors cursor-pointer ${
                            active
                              ? 'border-teal-600 bg-teal-50/40'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-bold text-slate-900">{plan.name}</p>
                            <p className="text-lg font-bold font-mono tabular-nums text-[#0B1528]">
                              ${plan.priceMonthly}
                              <span className="text-xs font-normal text-slate-500">/{plan.billingInterval}</span>
                            </p>
                          </div>
                          {plan.description && (
                            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{plan.description}</p>
                          )}
                          <p className="text-[11px] text-slate-500 mt-3 tabular-nums">
                            Up to {plan.maxStudents.toLocaleString()} students · {plan.maxTeachers} teachers ·{' '}
                            {plan.storageGb} GB · {plan.trialDays > 0 ? `${plan.trialDays}-day trial` : 'No trial needed'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* STEP 7 */}
              {step === 7 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 7 — Review, Consent & Submission
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Verify every section before submitting to Main Head. Click Edit on any block to adjust details
                      without losing your entries.
                    </p>
                  </div>

                  <div className="space-y-3 text-xs">
                    {[
                      {
                        stepNum: 1,
                        title: 'Applicant & Verification',
                        lines: [
                          `${draft.applicantName} (${draft.applicantDesignation})`,
                          `${draft.applicantEmail} · ${draft.applicantPhone}`,
                          draft.organizationName ? `Organization: ${draft.organizationName}` : '',
                        ].filter(Boolean),
                      },
                      {
                        stepNum: 2,
                        title: 'School Profile',
                        lines: [
                          `${draft.schoolName} (${draft.institutionType} · ${draft.affiliationBoard})`,
                          `Medium: ${draft.mediumOfInstruction || 'English'} · Est. ${draft.establishedYear || '—'}`,
                        ],
                      },
                      {
                        stepNum: 3,
                        title: 'Campus Location & Contact',
                        lines: [
                          `${draft.address}, ${draft.city}, ${draft.stateRegion} ${draft.postalCode}, ${draft.country}`,
                          `${draft.schoolEmail} · ${draft.schoolPhone}`,
                        ],
                      },
                      {
                        stepNum: 4,
                        title: 'Principal & Authentication',
                        lines: [
                          `${effectivePrincipalName} · ${effectivePrincipalEmail} · ${effectivePrincipalPhone || '—'}`,
                          `Preferred Login: ${draft.authMethod === 'google' ? 'Google Sign-In' : 'Email & Password'} (both supported after approval)`,
                        ],
                      },
                      {
                        stepNum: 5,
                        title: 'Academic Estimates & Preferred Plan',
                        lines: [
                          `Academic Year ${draft.academicYear} · ~${draft.estimatedStudents} students · ~${draft.estimatedTeachers} teachers`,
                          `Requested Plan: ${selectedPlan?.name} ($${selectedPlan?.priceMonthly}/${selectedPlan?.billingInterval})`,
                        ],
                      },
                    ].map((group) => (
                      <div key={group.stepNum} className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900">{group.title}</p>
                          {group.lines.map((l, i) => (
                            <p key={i} className="text-slate-600">
                              {l}
                            </p>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setStep(group.stepNum)}
                          className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-800 font-semibold shrink-0 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                      </div>
                    ))}
                  </div>

                  <label className="flex items-start gap-2.5 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.acceptedTerms}
                      onChange={(e) => updateField('acceptedTerms', e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-teal-600"
                    />
                    <span>
                      I confirm all submitted institutional details are accurate, accept the AcademiaOne{' '}
                      <Link to="/terms" target="_blank" className="text-teal-700 underline">
                        Terms of Service
                      </Link>{' '}
                      and{' '}
                      <Link to="/privacy" target="_blank" className="text-teal-700 underline">
                        Privacy Policy
                      </Link>{' '}
                      (Policy v{POLICY_VERSION}), and understand that school activation requires Main Head approval.
                    </span>
                  </label>
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {stepError && (
            <div className="mt-5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {stepError}
            </div>
          )}

          {/* Wizard Footer Actions */}
          <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={goBack} disabled={step === 1 || submitting}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>

            {step < 7 ? (
              <Button variant="navy" onClick={goNext}>
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="primary" disabled={submitting} onClick={handleFinalSubmit}>
                {submitting ? 'Submitting Application…' : 'Submit School Application'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

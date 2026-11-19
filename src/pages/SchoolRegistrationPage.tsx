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
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  BookOpen,
} from 'lucide-react';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, generateId, OperationType } from '../lib/firebase';
import { generateApplicationNumber, hashVerificationEmail } from '../lib/schoolProvisioning';
import {
  DEFAULT_CLASS_SECTION_PLAN,
  SECTION_LETTERS,
  STANDARD_CLASSES,
  countTotalClassSections,
  deriveSchoolPrefix,
  expandSectionRange,
  formatClassSectionPlanSummary,
  formatPrincipalCode,
  formatRoleCodeRange,
  formatSectionRangeLabel,
  isValidPhoneDigits,
  sanitizePhoneDigits,
  sanitizeSchoolPrefix,
} from '../lib/schoolCodes';
import {
  getStaggerContainerVariants,
  getStaggerItemVariants,
  getWizardStepVariants,
  MOTION_EASE,
} from '../lib/motion';
import { useAuth } from '../contexts/AuthContext';
import { Button, useToast } from '../components/ui/Primitives';
import { BrandLogo } from '../components/ui/BrandLogo';
import {
  DetectLocationAddressPicker,
  type DetectedAddressData,
} from '../components/shared/DetectLocationAddressPicker';
import type { ClassSectionRange } from '../types/models';

const DRAFT_STORAGE_KEY = 'academiaone_school_reg_draft_v4';
const POLICY_VERSION = '2026.11';

const STEP_META = [
  { id: 1, title: 'Account Sign-In & Applicant', short: 'Account', icon: UserCheck },
  { id: 2, title: 'School Basic Information', short: 'School Info', icon: Building2 },
  { id: 3, title: 'Address & Contact', short: 'Address', icon: MapPin },
  { id: 4, title: 'Principal Details', short: 'Principal', icon: Mail },
  { id: 5, title: 'Academic Profile', short: 'Academics', icon: BookOpen },
  { id: 6, title: 'Review & Submit', short: 'Review', icon: ShieldCheck },
] as const;

const TOTAL_STEPS = STEP_META.length;

/**
 * Truncates any value safely by UTF-8 byte length so Firestore Security Rules
 * `string.size()` (which counts UTF-8 bytes) never rejects multi-byte characters.
 */
function truncateUtf8(value: unknown, maxBytes: number): string {
  const str = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!str) return '';
  const encoder = new TextEncoder();
  if (encoder.encode(str).length <= maxBytes) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return str.slice(0, lo);
}

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
  classSectionPlan: ClassSectionRange[];
  schoolPrefix: string;
  estimatedCoordinators: string;
  estimatedStudents: string;
  estimatedTeachers: string;
  workingDaysSummary: string;
  // Step 6
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
  country: 'India',
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
  classesOffered: formatClassSectionPlanSummary(DEFAULT_CLASS_SECTION_PLAN),
  classSectionPlan: DEFAULT_CLASS_SECTION_PLAN,
  schoolPrefix: '',
  estimatedCoordinators: '6',
  estimatedStudents: '100',
  estimatedTeachers: '20',
  workingDaysSummary: 'Monday to Friday',
  acceptedTerms: false,
};

const CLASS_PLAN_PRESETS: { label: string; grades: string[]; from: string; to: string }[] = [
  { label: 'Class 1–2 (A–G, A–H)', grades: [], from: 'A', to: 'G' },
  { label: 'Class 1–5 (A–D)', grades: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'], from: 'A', to: 'D' },
  { label: 'Class 1–8 (A–F)', grades: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8'], from: 'A', to: 'F' },
  { label: 'Class 1–10 (A–G)', grades: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'], from: 'A', to: 'G' },
  { label: 'Class 1–12 (A–D)', grades: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'], from: 'A', to: 'D' },
];

export default function SchoolRegistrationPage() {
  const { firebaseUser, activeUser, loading: authLoading, signInUnified, signUpEmailPassword, signInGoogle, logout } =
    useAuth();
  const { pushToast } = useToast();
  const prefersReducedMotion = useReducedMotion();

  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [draft, setDraft] = useState<RegistrationDraft>(() => {
    try {
      const saved =
        localStorage.getItem(DRAFT_STORAGE_KEY) ||
        localStorage.getItem('academiaone_school_reg_draft_v3') ||
        localStorage.getItem('academiaone_school_reg_draft_v2') ||
        localStorage.getItem('academiaone_school_reg_draft_v1');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<RegistrationDraft>;
        const safeMethod = parsed.authMethod === 'email_password' ? 'email_password' : 'google';
        const validPlan =
          Array.isArray(parsed.classSectionPlan) && parsed.classSectionPlan.length > 0
            ? parsed.classSectionPlan
            : DEFAULT_CLASS_SECTION_PLAN;
        return {
          ...INITIAL_DRAFT,
          ...parsed,
          applicantPhone: sanitizePhoneDigits(parsed.applicantPhone || ''),
          schoolPhone: sanitizePhoneDigits(parsed.schoolPhone || ''),
          alternateContact: sanitizePhoneDigits(parsed.alternateContact || ''),
          principalPhone: sanitizePhoneDigits(parsed.principalPhone || ''),
          classSectionPlan: validPlan,
          classesOffered: formatClassSectionPlanSummary(validPlan),
          authMethod: safeMethod,
        };
      }
    } catch {
      // ignore corrupted localStorage
    }
    return INITIAL_DRAFT;
  });

  // Step 5 Add-Class Row Picker state (choose, never free-type)
  const [newClassGrade, setNewClassGrade] = useState('Class 3');
  const [newSectionFrom, setNewSectionFrom] = useState('A');
  const [newSectionTo, setNewSectionTo] = useState('D');

  // Step 1 Inline Auth State (Email & Password or Google Sign-In)
  const [authTab, setAuthTab] = useState<'signup' | 'signin'>('signup');
  const [authFullName, setAuthFullName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [authInlineError, setAuthInlineError] = useState('');
  const [needsEmailSetup, setNeedsEmailSetup] = useState(false);

  const [stepError, setStepError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [draftSavedTick, setDraftSavedTick] = useState(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const [submittedRef, setSubmittedRef] = useState<{
    applicationNumber: string;
    schoolName: string;
    principalEmail: string;
    applicantEmail: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const signedInProvider: 'google' | 'email_password' = firebaseUser?.providerData?.some(
    (p) => p.providerId === 'google.com',
  )
    ? 'google'
    : 'email_password';

  // Auto-sync signed-in account details into the registration draft
  useEffect(() => {
    if (!firebaseUser) return;
    const email = (firebaseUser.email || activeUser?.email || '').trim().toLowerCase();
    const displayName = (activeUser?.displayName || firebaseUser.displayName || '').trim();
    const method: 'google' | 'email_password' = firebaseUser.providerData?.some(
      (p) => p.providerId === 'google.com',
    )
      ? 'google'
      : 'email_password';

    setDraft((prev) => ({
      ...prev,
      applicantEmail: email || prev.applicantEmail,
      applicantName: prev.applicantName || displayName,
      principalEmail: prev.applicantIsPrincipal ? email || prev.principalEmail : prev.principalEmail,
      principalName: prev.applicantIsPrincipal ? prev.applicantName || displayName : prev.principalName,
      authMethod: method,
    }));
  }, [firebaseUser, activeUser]);

  const updateField = <K extends keyof RegistrationDraft>(key: K, value: RegistrationDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setStepError('');
  };

  const handleStep1EmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthInlineError('');
    setNeedsEmailSetup(false);

    const cleanEmail = authEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setAuthInlineError('Enter a valid email address.');
      return;
    }

    if (authTab === 'signup') {
      if (authFullName.trim().length < 2) {
        setAuthInlineError('Enter your full name (at least 2 characters).');
        return;
      }
      if (authPassword.length < 8) {
        setAuthInlineError('Password must be at least 8 characters long.');
        return;
      }
      if (authPassword !== authConfirmPassword) {
        setAuthInlineError('Passwords do not match.');
        return;
      }
      setAuthSubmitting(true);
      try {
        const derivedUsername = cleanEmail
          .split('@')[0]
          .replace(/[^a-z0-9._-]/g, '')
          .slice(0, 32);
        const res = await signUpEmailPassword({
          displayName: authFullName.trim(),
          username: derivedUsername.length >= 3 ? derivedUsername : `school_${Date.now().toString(36).slice(-5)}`,
          email: cleanEmail,
          password: authPassword,
        });
        if (!res.ok) {
          setAuthInlineError(res.error || 'Could not create account.');
          if (res.needsEmailAuthSetup) setNeedsEmailSetup(true);
          return;
        }
        setDraft((prev) => ({
          ...prev,
          applicantName: prev.applicantName || authFullName.trim(),
          applicantEmail: cleanEmail,
          authMethod: 'email_password',
        }));
        pushToast('success', 'Account created and signed in. Complete your applicant details below.');
      } finally {
        setAuthSubmitting(false);
      }
    } else {
      if (!authPassword) {
        setAuthInlineError('Enter your password.');
        return;
      }
      setAuthSubmitting(true);
      try {
        const res = await signInUnified(cleanEmail, authPassword);
        if (!res.ok) {
          setAuthInlineError(res.error || 'Invalid email or password.');
          if (res.needsEmailAuthSetup) setNeedsEmailSetup(true);
          return;
        }
        pushToast('success', `Signed in as ${res.profile?.displayName || cleanEmail}.`);
      } finally {
        setAuthSubmitting(false);
      }
    }
  };

  const handleStep1GoogleAuth = async () => {
    setAuthInlineError('');
    setNeedsEmailSetup(false);
    setGoogleSubmitting(true);
    try {
      const res = await signInGoogle();
      if (!res.ok) {
        setAuthInlineError(res.error || 'Google sign-in could not complete.');
        return;
      }
      pushToast('success', `Signed in with Google as ${res.profile?.displayName || res.profile?.email}.`);
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleSaveDraft = () => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      setDraftSavedTick(true);
      setTimeout(() => setDraftSavedTick(false), 2200);
      pushToast('success', 'Application draft saved locally. You can resume anytime on this browser.');
    } catch {
      pushToast('warning', 'Draft could not be saved locally (storage limit reached).');
    }
  };

  const processLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setStepError('Logo must be a PNG, JPG, or WEBP image.');
      return;
    }
    if (file.size > 250 * 1024) {
      setStepError('Please upload a compact school logo under 250 KB for fast verification.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result.length > 480000) {
        setStepError('Encoded logo is too large. Please upload a smaller image under 250 KB.');
        return;
      }
      updateField('logoDataUrl', result);
      updateField('logoFileName', file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    processLogoFile(e.target.files?.[0]);
  };

  const handleLocationDetected = (data: DetectedAddressData) => {
    setDraft((prev) => ({
      ...prev,
      address: data.streetAddress || data.formattedAddress || prev.address,
      city: data.city || prev.city,
      district: data.district || prev.district,
      stateRegion: data.stateRegion || prev.stateRegion,
      country: data.country || prev.country,
      postalCode: data.postalCode || prev.postalCode,
    }));
    setStepError('');
    pushToast('success', 'School address auto-filled from detected location. Review or refine any field below.');
  };

  const updateClassPlan = (nextPlan: ClassSectionRange[]) => {
    setDraft((prev) => ({
      ...prev,
      classSectionPlan: nextPlan,
      classesOffered: formatClassSectionPlanSummary(nextPlan),
    }));
    setStepError('');
  };

  const effectivePrefix = sanitizeSchoolPrefix(draft.schoolPrefix) || deriveSchoolPrefix(draft.schoolName);

  const validateStep = (targetStep: number): string | null => {
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (targetStep === 1) {
      if (!firebaseUser) {
        return 'Sign in or create your account using Email & Password or Google Sign-In before continuing.';
      }
      const effectiveApplicantEmail = (firebaseUser.email || draft.applicantEmail).trim().toLowerCase();
      if (draft.applicantName.trim().length < 2) return 'Enter the applicant full name (at least 2 characters).';
      if (!emailRe.test(effectiveApplicantEmail)) return 'A valid account email address is required.';
      if (!isValidPhoneDigits(draft.applicantPhone)) {
        return 'Applicant mobile number must contain strictly 10 to 15 numeric digits (numbers only).';
      }
      if (draft.applicantDesignation !== 'Principal' && draft.authorityRelationship.trim().length < 2) {
        return 'Specify your relationship or authority to register on behalf of the school.';
      }
      if (!draft.contactConsent) return 'Accept contact consent and the privacy notice to proceed.';
    }
    if (targetStep === 2) {
      if (draft.schoolName.trim().length < 2) return 'Enter the official registered school name.';
      if (!draft.institutionType) return 'Select the school type.';
      if (!draft.affiliationBoard) return 'Select the education board or affiliation.';
    }
    if (targetStep === 3) {
      if (draft.country.trim().length < 2) return 'Enter the school country.';
      if (draft.stateRegion.trim().length < 2) return 'Enter the school state or province.';
      if (draft.city.trim().length < 2) return 'Enter the school city or town.';
      if (draft.address.trim().length < 4) return 'Enter the full registered school street address (or use Detect Location).';
      if (!emailRe.test(draft.schoolEmail.trim())) return 'Enter a valid official school email address.';
      if (!isValidPhoneDigits(draft.schoolPhone)) {
        return 'Official school phone must contain strictly 10 to 15 numeric digits (numbers only).';
      }
      if (draft.alternateContact.trim() && !isValidPhoneDigits(draft.alternateContact)) {
        return 'Alternate contact number must contain strictly 10 to 15 numeric digits (numbers only).';
      }
    }
    if (targetStep === 4) {
      const signedEmail = (firebaseUser?.email || draft.applicantEmail).trim().toLowerCase();
      const pName = draft.applicantIsPrincipal ? draft.applicantName : draft.principalName;
      const pEmail = draft.applicantIsPrincipal ? signedEmail : draft.principalEmail;
      if (pName.trim().length < 2) return 'Enter the Principal full name.';
      if (!emailRe.test(pEmail.trim())) return 'Enter a valid official Principal email ID.';
      if (!draft.applicantIsPrincipal && draft.principalPhone.trim() && !isValidPhoneDigits(draft.principalPhone)) {
        return 'Principal mobile number must contain strictly 10 to 15 numeric digits (numbers only).';
      }
    }
    if (targetStep === 5) {
      if (draft.academicYear.trim().length < 2) return 'Enter the current academic year (e.g., 2026-2027).';
      if (!draft.classSectionPlan || draft.classSectionPlan.length === 0) {
        return 'Select at least one Class and Section range from the dropdowns.';
      }
      if (effectivePrefix.length < 2) {
        return 'School Code Prefix must contain at least 2 letters (A–Z).';
      }
      if (countTotalClassSections(draft.classSectionPlan) > 200) {
        return 'Please keep total class-sections to 200 or fewer during initial registration.';
      }
    }
    if (targetStep === 6) {
      if (!draft.acceptedTerms) return 'You must accept the Terms of Service and Privacy Policy before submitting.';
    }
    return null;
  };

  const navigateStep = (target: number) => {
    setDirection(target >= step ? 1 : -1);
    setStepError('');
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    if (step === 1 && draft.applicantIsPrincipal) {
      const signedEmail = (firebaseUser?.email || draft.applicantEmail).trim().toLowerCase();
      setDraft((prev) => ({
        ...prev,
        applicantEmail: signedEmail,
        principalName: prev.principalName || prev.applicantName,
        principalEmail: signedEmail || prev.principalEmail,
        principalPhone: prev.principalPhone || prev.applicantPhone,
      }));
    }
    navigateStep(Math.min(TOTAL_STEPS, step + 1));
  };

  const goBack = () => {
    navigateStep(Math.max(1, step - 1));
  };

  const handleFinalSubmit = async () => {
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const err = validateStep(i);
      if (err) {
        setDirection(i >= step ? 1 : -1);
        setStep(i);
        setStepError(`Step ${i}: ${err}`);
        return;
      }
    }

    if (!firebaseUser) {
      setDirection(-1);
      setStep(1);
      setStepError('Please sign in with Email & Password or Google in Step 1 before submitting.');
      return;
    }

    setSubmitting(true);
    setStepError('');

    const applicationId = generateId('app');
    const applicationNumber = generateApplicationNumber('SCH');
    const effectiveApplicantEmail = (firebaseUser.email || draft.applicantEmail).trim().toLowerCase();
    const effectivePrincipalName = (draft.applicantIsPrincipal ? draft.applicantName : draft.principalName).trim();
    const effectivePrincipalEmail = (draft.applicantIsPrincipal ? effectiveApplicantEmail : draft.principalEmail)
      .trim()
      .toLowerCase();
    const effectivePrincipalPhone = (draft.applicantIsPrincipal ? draft.applicantPhone : draft.principalPhone).trim();
    const safeAuthMethod: 'google' | 'email_password' =
      draft.authMethod === 'email_password' ? 'email_password' : 'google';
    const submittedIso = new Date().toISOString();
    const estCoordinators = Math.max(0, Math.min(5000, Math.round(Number(draft.estimatedCoordinators) || 0)));
    const estStudents = Math.max(0, Math.min(200000, Math.round(Number(draft.estimatedStudents) || 0)));
    const estTeachers = Math.max(0, Math.min(50000, Math.round(Number(draft.estimatedTeachers) || 0)));
    const cleanClassPlan: ClassSectionRange[] = (draft.classSectionPlan || DEFAULT_CLASS_SECTION_PLAN)
      .slice(0, 30)
      .map((row) => ({
        grade: truncateUtf8(row.grade, 24),
        sectionFrom: row.sectionFrom.slice(0, 1).toUpperCase(),
        sectionTo: row.sectionTo.slice(0, 1).toUpperCase(),
      }));
    const classesSummary = formatClassSectionPlanSummary(cleanClassPlan);
    const chosenPrefix = sanitizeSchoolPrefix(draft.schoolPrefix) || deriveSchoolPrefix(draft.schoolName);

    try {
      const verificationEmailHash = await hashVerificationEmail(effectiveApplicantEmail);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      const applicationPayload = {
        id: applicationId,
        applicationNumber,
        applicantUid: firebaseUser.uid,
        applicantName: truncateUtf8(draft.applicantName, 120),
        applicantDesignation: truncateUtf8(draft.applicantDesignation || 'Principal', 64),
        applicantEmail: truncateUtf8(effectiveApplicantEmail, 160),
        applicantPhone: sanitizePhoneDigits(draft.applicantPhone),
        organizationName: truncateUtf8(draft.organizationName, 200),
        preferredContactMethod: truncateUtf8(draft.preferredContactMethod || 'Email', 32),
        authorityRelationship: truncateUtf8(draft.authorityRelationship, 200),
        applicantIsPrincipal: Boolean(draft.applicantIsPrincipal),
        contactVerified: true,
        schoolName: truncateUtf8(draft.schoolName, 200),
        displayName: truncateUtf8(draft.displayName || draft.schoolName, 200),
        institutionType: truncateUtf8(draft.institutionType || 'Private', 64),
        affiliationBoard: truncateUtf8(draft.affiliationBoard || 'CBSE', 120),
        mediumOfInstruction: truncateUtf8(draft.mediumOfInstruction || 'English', 120),
        establishedYear: truncateUtf8(draft.establishedYear, 32),
        externalRecognitionCode: truncateUtf8(draft.externalRecognitionCode, 64),
        logoDataUrl: truncateUtf8(draft.logoDataUrl, 480000),
        academicYear: truncateUtf8(draft.academicYear, 40),
        website: truncateUtf8(draft.website, 300),
        schoolEmail: truncateUtf8(draft.schoolEmail.toLowerCase(), 160),
        schoolPhone: sanitizePhoneDigits(draft.schoolPhone),
        alternateContact: sanitizePhoneDigits(draft.alternateContact),
        country: truncateUtf8(draft.country, 80),
        stateRegion: truncateUtf8(draft.stateRegion, 80),
        district: truncateUtf8(draft.district, 80),
        city: truncateUtf8(draft.city, 80),
        postalCode: truncateUtf8(draft.postalCode, 32),
        address: truncateUtf8(draft.address, 500),
        campusAddress: truncateUtf8(draft.campusAddress, 500),
        classesOffered: truncateUtf8(classesSummary, 780),
        classSectionPlan: cleanClassPlan,
        schoolPrefix: chosenPrefix,
        estimatedCoordinators: estCoordinators,
        estimatedStudents: estStudents,
        estimatedTeachers: estTeachers,
        workingDaysSummary: truncateUtf8(draft.workingDaysSummary, 120),
        principalName: truncateUtf8(effectivePrincipalName, 120),
        principalEmail: truncateUtf8(effectivePrincipalEmail, 160),
        principalPhone: sanitizePhoneDigits(effectivePrincipalPhone),
        principalDesignation: truncateUtf8(draft.principalDesignation || 'Principal', 120),
        authMethod: safeAuthMethod,
        requestedPlanId: 'plan_free',
        consentPolicyVersion: POLICY_VERSION,
        status: 'submitted' as const,
        internalNotes: '',
        applicantMessage: 'Your school application has been received and queued for Main Head review.',
        decisionNote: '',
        approvedSchoolId: '',
        approvedSchoolCode: '',
        reviewedBy: '',
        activityLog: [
          {
            at: submittedIso,
            actor: truncateUtf8(draft.applicantName, 120),
            action: 'APPLICATION_SUBMITTED',
            note: `Submitted free campus registration (${safeAuthMethod === 'google' ? 'Google Sign-In' : 'Email & Password'}).`,
          },
        ],
        createdAt: now,
        updatedAt: now,
      };

      const statusPayload = {
        applicationNumber,
        type: 'school' as const,
        verificationEmailHash: truncateUtf8(verificationEmailHash, 128),
        schoolId: '',
        schoolName: truncateUtf8(draft.schoolName, 200),
        requestedRole: 'principal' as const,
        status: 'submitted' as const,
        schoolCode: '',
        applicantMessage: 'Application received. Our Main Head administrator will review your school details shortly.',
        decisionNote: '',
        applicantResponseNote: '',
        submittedAt: truncateUtf8(submittedIso, 40),
        createdAt: now,
        updatedAt: now,
      };

      batch.set(doc(db, 'schoolApplications', applicationId), applicationPayload);
      batch.set(doc(db, 'applicationStatuses', applicationNumber), statusPayload);

      await batch.commit();
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem('academiaone_school_reg_draft_v2');
      localStorage.removeItem('academiaone_school_reg_draft_v1');
      setSubmittedRef({
        applicationNumber,
        schoolName: draft.schoolName.trim(),
        principalEmail: effectivePrincipalEmail,
        applicantEmail: effectiveApplicantEmail,
      });
      pushToast('success', `School application ${applicationNumber} submitted for Main Head review.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        'School application submission failed:',
        JSON.stringify({
          error: msg,
          operationType: OperationType.CREATE,
          path: `schoolApplications/${applicationId}`,
          uid: firebaseUser.uid,
          email: firebaseUser.email,
        }),
      );
      if (msg.toLowerCase().includes('permission')) {
        setStepError(
          `Server rejected the application (${msg}). Verify you are signed in and all required fields are filled accurately, then try again.`,
        );
      } else {
        setStepError(
          msg ? `Submission failed: ${msg}` : 'Unable to submit school application right now. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveApplicantEmail = (firebaseUser?.email || draft.applicantEmail).trim().toLowerCase();
  const effectivePrincipalName = draft.applicantIsPrincipal ? draft.applicantName : draft.principalName;
  const effectivePrincipalEmail = draft.applicantIsPrincipal ? effectiveApplicantEmail : draft.principalEmail;
  const effectivePrincipalPhone = draft.applicantIsPrincipal ? draft.applicantPhone : draft.principalPhone;
  const authBusy = authSubmitting || googleSubmitting;

  if (submittedRef) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center py-12 px-4 sm:px-6">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: MOTION_EASE.out }}
          className="max-w-xl w-full mx-auto bg-white border border-slate-200 rounded-xl p-8 shadow-sm"
        >
          <div className="flex items-center justify-between gap-4 mb-5">
            <BrandLogo size="sm" />
            <motion.div
              initial={prefersReducedMotion ? false : { scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.08, ease: MOTION_EASE.out }}
              className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center"
            >
              <CheckCircle2 className="w-5 h-5" />
            </motion.div>
          </div>
          <p className="text-xs font-semibold text-teal-700">Application Submitted · Pending Main Head Review</p>
          <h1 className="text-2xl font-bold font-display text-slate-900 mt-1">
            {submittedRef.schoolName} application received
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Your school tenant is queued for verification. Once approved by the Main Head, a unique{' '}
            <strong>School Code</strong> will be auto-generated and full free Principal access for{' '}
            <span className="font-mono text-xs text-slate-800">{submittedRef.principalEmail}</span> will be activated.
          </p>

          <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-5">
            <p className="text-xs font-medium text-slate-500">Your Unique Application Number</p>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <span className="text-xl font-bold font-mono tabular-nums tracking-wider text-[#101C35]">
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
    <div className="min-h-screen bg-[#F8FAFC] pb-16">
      {/* Top Bar */}
      <header className="bg-[#101C35] text-white border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="hover:opacity-90 transition-opacity">
              <BrandLogo size="sm" tone="dark" />
            </Link>
            <span className="text-slate-600 hidden sm:inline">/</span>
            <span className="text-xs text-slate-300 hidden sm:inline">Free School Registration</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/application-status" className="text-teal-300 hover:text-teal-200 font-medium transition-colors">
              Track Application
            </Link>
            <Link to="/login" className="text-slate-300 hover:text-white font-medium transition-colors">
              Sign In
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-7">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to AcademiaOne
            </Link>
            <h1 className="text-2xl font-bold font-display text-slate-900 mt-1">Register Your School</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              100% free for every school. Sign in first, complete 6 quick steps, and receive your unique School Code upon Main Head approval.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleSaveDraft} disabled={submitting}>
            {draftSavedTick ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" /> Draft Saved
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" /> Save Draft
              </>
            )}
          </Button>
        </div>

        {/* Stepper & Animated Progress Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between text-xs mb-2.5">
            <span className="font-semibold text-slate-900">
              Step {step} of {TOTAL_STEPS} · {STEP_META[step - 1].title}
            </span>
            <span className="text-slate-500 tabular-nums">{Math.round((step / TOTAL_STEPS) * 100)}% complete</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-teal-600 rounded-full"
              initial={false}
              animate={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: MOTION_EASE.out }}
            />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-4">
            {STEP_META.map((s) => {
              const done = s.id < step;
              const current = s.id === step;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (s.id < step) navigateStep(s.id);
                  }}
                  disabled={s.id > step}
                  className={`text-left px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors truncate ${
                    current
                      ? 'bg-[#101C35] text-white'
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
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              variants={getWizardStepVariants(direction, prefersReducedMotion)}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-5"
            >
              {/* STEP 1: ACCOUNT SIGN-IN (EMAIL & PASSWORD OR GOOGLE) + APPLICANT DETAILS */}
              {step === 1 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 1 — Sign In & Applicant Details
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Sign in with Email & Password or Google first to link your verified account to this school registration.
                    </p>
                  </div>

                  {authLoading ? (
                    <div className="p-6 rounded-xl border border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
                      Checking your sign-in session…
                    </div>
                  ) : !firebaseUser ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <LogIn className="w-4 h-4 text-teal-700" />
                          <p className="text-sm font-bold font-display text-slate-900">
                            Verify Your Login to Register a School
                          </p>
                        </div>
                        <div className="inline-flex rounded-lg bg-slate-200/80 p-0.5 text-xs font-medium">
                          <button
                            type="button"
                            onClick={() => {
                              setAuthTab('signup');
                              setAuthInlineError('');
                            }}
                            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                              authTab === 'signup' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Create Account
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAuthTab('signin');
                              setAuthInlineError('');
                            }}
                            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                              authTab === 'signin' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Existing Account
                          </button>
                        </div>
                      </div>

                      {/* Google Sign-In Option */}
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full !bg-white"
                          onClick={handleStep1GoogleAuth}
                          loading={googleSubmitting}
                          disabled={authBusy}
                        >
                          {googleSubmitting ? 'Connecting to Google…' : 'Continue with Google'}
                        </Button>
                      </div>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-200" />
                        </div>
                        <div className="relative flex justify-center text-xs">
                          <span className="px-2.5 bg-slate-50 text-slate-400">
                            or {authTab === 'signup' ? 'create an account' : 'sign in'} with Email & Password
                          </span>
                        </div>
                      </div>

                      <form onSubmit={handleStep1EmailAuth} className="space-y-3.5" noValidate>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          {authTab === 'signup' && (
                            <div className="sm:col-span-2">
                              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                              <input
                                type="text"
                                required
                                disabled={authBusy}
                                value={authFullName}
                                onChange={(e) => setAuthFullName(e.target.value)}
                                placeholder="Dr. Eleanor Vance"
                                className="w-full text-sm bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                              />
                            </div>
                          )}
                          <div className={authTab === 'signup' ? 'sm:col-span-2' : 'sm:col-span-2'}>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address *</label>
                            <input
                              type="email"
                              required
                              disabled={authBusy}
                              value={authEmail}
                              onChange={(e) => setAuthEmail(e.target.value)}
                              placeholder="principal@school.edu"
                              className="w-full text-sm bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                            />
                          </div>
                          <div className={authTab === 'signin' ? 'sm:col-span-2' : ''}>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">Password *</label>
                            <div className="relative">
                              <input
                                type={showAuthPassword ? 'text' : 'password'}
                                required
                                disabled={authBusy}
                                value={authPassword}
                                onChange={(e) => setAuthPassword(e.target.value)}
                                placeholder={authTab === 'signup' ? 'Minimum 8 characters' : 'Enter your password'}
                                className="w-full text-sm bg-white border border-slate-300 rounded-lg pl-3.5 pr-10 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                              />
                              <button
                                type="button"
                                onClick={() => setShowAuthPassword((v) => !v)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                aria-label={showAuthPassword ? 'Hide password' : 'Show password'}
                              >
                                {showAuthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          {authTab === 'signup' && (
                            <div>
                              <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm Password *</label>
                              <input
                                type={showAuthPassword ? 'text' : 'password'}
                                required
                                disabled={authBusy}
                                value={authConfirmPassword}
                                onChange={(e) => setAuthConfirmPassword(e.target.value)}
                                placeholder="Re-enter password"
                                className="w-full text-sm bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                              />
                            </div>
                          )}
                        </div>

                        {authInlineError && (
                          <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
                            {authInlineError}
                            {needsEmailSetup && (
                              <p className="mt-1.5 text-slate-700">
                                You can use <strong>Continue with Google</strong> above right away, or enable{' '}
                                <span className="font-mono">Authentication → Sign-in method → Email/Password</span> in Firebase Console.
                              </p>
                            )}
                          </div>
                        )}

                        <Button type="submit" variant="navy" className="w-full" loading={authSubmitting} disabled={authBusy}>
                          {authSubmitting
                            ? authTab === 'signup'
                              ? 'Creating Account…'
                              : 'Signing In…'
                            : authTab === 'signup'
                              ? 'Create Account & Continue'
                              : 'Sign In & Continue'}
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <>
                      {/* Verified Signed-In Account Card */}
                      <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-emerald-900">
                              Account Verified · {signedInProvider === 'google' ? 'Google Sign-In' : 'Email & Password'}
                            </p>
                            <p className="text-xs text-emerald-800 truncate mt-0.5">
                              <strong>{activeUser?.displayName || firebaseUser.displayName || draft.applicantName || 'Applicant'}</strong>{' '}
                              ({effectiveApplicantEmail})
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            await logout();
                            pushToast('info', 'Signed out. Sign in with another account to continue.');
                          }}
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Switch Account
                        </Button>
                      </div>

                      {/* Applicant Contact Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Applicant Full Name *</label>
                          <input
                            value={draft.applicantName}
                            onChange={(e) => updateField('applicantName', e.target.value)}
                            placeholder="Dr. Eleanor Vance"
                            className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
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
                            className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 bg-white transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                          >
                            <option value="Principal">Principal</option>
                            <option value="School Owner">School Owner</option>
                            <option value="Director">Director</option>
                            <option value="Authorized Representative">Authorized Representative</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Verified Account Email</label>
                          <input
                            type="email"
                            value={effectiveApplicantEmail}
                            readOnly
                            className="w-full text-sm border border-slate-200 bg-slate-50 text-slate-600 rounded-lg px-3.5 py-2.5"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Mobile Number * <span className="font-normal text-slate-400">(Numbers only)</span>
                          </label>
                          <input
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={15}
                            value={draft.applicantPhone}
                            onChange={(e) => updateField('applicantPhone', sanitizePhoneDigits(e.target.value))}
                            placeholder="9876543210"
                            className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                          />
                          <p className="text-[11px] text-slate-400 mt-1">Enter 10–15 digits only (no words or symbols).</p>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Management / Trust / Organization (Optional)
                          </label>
                          <input
                            value={draft.organizationName}
                            onChange={(e) => updateField('organizationName', e.target.value)}
                            placeholder="Northridge Education Trust"
                            className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Preferred Contact Channel</label>
                          <select
                            value={draft.preferredContactMethod}
                            onChange={(e) => updateField('preferredContactMethod', e.target.value)}
                            className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 bg-white transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
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
                            className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                          />
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-100">
                        <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={draft.contactConsent}
                            onChange={(e) => updateField('contactConsent', e.target.checked)}
                            className="mt-0.5 rounded border-slate-300 text-teal-600"
                          />
                          <span>
                            I consent to AcademiaOne contacting me at <strong>{effectiveApplicantEmail}</strong> regarding
                            this school registration and accept the{' '}
                            <Link to="/privacy" target="_blank" className="text-teal-700 underline">
                              Privacy Policy
                            </Link>
                            .
                          </span>
                        </label>
                      </div>
                    </>
                  )}
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
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Display Name (Optional)</label>
                      <input
                        value={draft.displayName}
                        onChange={(e) => updateField('displayName', e.target.value)}
                        placeholder="St. Xavier Prep"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">School Type *</label>
                      <select
                        value={draft.institutionType}
                        onChange={(e) => updateField('institutionType', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 bg-white transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
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
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 bg-white transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
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
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Establishment Year</label>
                      <input
                        value={draft.establishedYear}
                        onChange={(e) => updateField('establishedYear', e.target.value)}
                        placeholder="1998"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">School Website (Optional)</label>
                      <input
                        value={draft.website}
                        onChange={(e) => updateField('website', e.target.value)}
                        placeholder="https://school.edu"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
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
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                  </div>

                  {/* Logo Drag & Drop Upload Zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingLogo(true);
                    }}
                    onDragLeave={() => setIsDraggingLogo(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingLogo(false);
                      processLogoFile(e.dataTransfer.files?.[0]);
                    }}
                    className={`border-2 border-dashed rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 transition-colors duration-150 ${
                      isDraggingLogo
                        ? 'border-teal-500 bg-teal-50/70'
                        : 'border-slate-300 bg-slate-50/70 hover:border-slate-400'
                    }`}
                  >
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
                        <p className="text-[11px] text-slate-500">Drag & drop or choose PNG, JPG, or WEBP up to 250 KB</p>
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">
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
                      Use GPS location detection to fill your campus address automatically, or enter details manually below.
                    </p>
                  </div>

                  {/* Google Maps Platform GPS Address Auto-Fill */}
                  <DetectLocationAddressPicker
                    onAddressDetected={handleLocationDetected}
                    label="Detect School Campus Location"
                    helperText="Click Detect Current Location to fill street address, city, district, state, country, and postal code — then fine-tune the map pin or edit any field."
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Country *</label>
                      <input
                        value={draft.country}
                        onChange={(e) => updateField('country', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">State / Province *</label>
                      <input
                        value={draft.stateRegion}
                        onChange={(e) => updateField('stateRegion', e.target.value)}
                        placeholder="California / Karnataka"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">District / County</label>
                      <input
                        value={draft.district}
                        onChange={(e) => updateField('district', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">City / Town *</label>
                        <input
                          value={draft.city}
                          onChange={(e) => updateField('city', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">PIN / Postal Code</label>
                        <input
                          value={draft.postalCode}
                          onChange={(e) => updateField('postalCode', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Full Registered Address *</label>
                      <input
                        value={draft.address}
                        onChange={(e) => updateField('address', e.target.value)}
                        placeholder="420 Oakridge Boulevard, North Wing"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Official School Email *</label>
                      <input
                        type="email"
                        value={draft.schoolEmail}
                        onChange={(e) => updateField('schoolEmail', e.target.value)}
                        placeholder="office@school.edu"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Official School Phone * <span className="font-normal text-slate-400">(Numbers only)</span>
                      </label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={15}
                        value={draft.schoolPhone}
                        onChange={(e) => updateField('schoolPhone', sanitizePhoneDigits(e.target.value))}
                        placeholder="8012345678"
                        className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Alternate Phone Number <span className="font-normal text-slate-400">(Optional, numbers only)</span>
                      </label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={15}
                        value={draft.alternateContact}
                        onChange={(e) => updateField('alternateContact', sanitizePhoneDigits(e.target.value))}
                        placeholder="9876543211"
                        className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Separate Campus Address (If Different)
                      </label>
                      <input
                        value={draft.campusAddress}
                        onChange={(e) => updateField('campusAddress', e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
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
                      Step 4 — Principal Details & Portal Access
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Once Main Head approves your school, this Principal email will automatically unlock the Principal Portal via either Email & Password or Google Sign-In.
                    </p>
                  </div>

                  <label className="flex items-center gap-2.5 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.applicantIsPrincipal}
                      onChange={(e) => updateField('applicantIsPrincipal', e.target.checked)}
                      className="rounded border-slate-300 text-teal-600"
                    />
                    I ({draft.applicantName || effectiveApplicantEmail}) am also the School Principal
                  </label>

                  {!draft.applicantIsPrincipal && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Principal Full Name *</label>
                        <input
                          value={draft.principalName}
                          onChange={(e) => updateField('principalName', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Designation</label>
                        <input
                          value={draft.principalDesignation}
                          onChange={(e) => updateField('principalDesignation', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Principal Official Email *</label>
                        <input
                          type="email"
                          value={draft.principalEmail}
                          onChange={(e) => updateField('principalEmail', e.target.value)}
                          placeholder="principal@school.edu"
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Principal Mobile Number <span className="font-normal text-slate-400">(Numbers only)</span>
                        </label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={15}
                          value={draft.principalPhone}
                          onChange={(e) => updateField('principalPhone', sanitizePhoneDigits(e.target.value))}
                          placeholder="9876543210"
                          className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                    </div>
                  )}

                  <div className="pt-2">
                    <p className="text-xs font-semibold text-slate-700 mb-2.5">
                      Preferred Principal Sign-In Method After Approval
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
                            desc: 'Log in with your registered Principal email and private password once approved.',
                          },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => updateField('authMethod', opt.id)}
                          className={`text-left p-4 rounded-xl border transition-all duration-150 cursor-pointer ${
                            draft.authMethod === opt.id
                              ? 'border-teal-600 bg-teal-50/40 ring-1 ring-teal-500/20'
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

              {/* STEP 5: CLASSES & SECTIONS (CHOOSE-NOT-WRITE) + ROLE CODE ALLOCATION */}
              {step === 5 && (() => {
                const usedGrades = new Set(draft.classSectionPlan.map((r) => r.grade));
                const availableGrades = STANDARD_CLASSES.filter((g) => !usedGrades.has(g));
                const totalClassSections = countTotalClassSections(draft.classSectionPlan);
                const coordCount = Math.max(0, Number(draft.estimatedCoordinators) || 0);
                const teacherCount = Math.max(0, Number(draft.estimatedTeachers) || 0);
                const studentCount = Math.max(0, Number(draft.estimatedStudents) || 0);
                const previewPrefix = effectivePrefix || 'SCH';

                return (
                  <>
                    <div>
                      <h2 className="text-lg font-bold font-display text-slate-900">
                        Step 5 — Classes, Sections & Access Code Allocation
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Choose your school&apos;s classes and section ranges from the dropdowns below, and specify your
                        member counts so role-specific access codes are generated automatically upon approval.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Current Academic Year *</label>
                        <input
                          value={draft.academicYear}
                          onChange={(e) => updateField('academicYear', e.target.value)}
                          placeholder="2026-2027"
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Working Days</label>
                        <select
                          value={draft.workingDaysSummary}
                          onChange={(e) => updateField('workingDaysSummary', e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg px-3.5 py-2.5 bg-white transition-colors focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        >
                          <option value="Monday to Friday">Monday to Friday</option>
                          <option value="Monday to Saturday">Monday to Saturday</option>
                          <option value="Monday to Saturday (Half-Day Sat)">Monday to Saturday (Half-Day Sat)</option>
                          <option value="Sunday to Thursday">Sunday to Thursday</option>
                        </select>
                      </div>
                    </div>

                    {/* Choose Classes & Section Ranges (No Free-Text Typing) */}
                    <div className="border border-slate-200 rounded-xl p-4 sm:p-5 bg-slate-50/60 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold text-slate-900">
                            Assign Classes &amp; Sections * <span className="font-normal text-slate-500">(Choose from dropdowns)</span>
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Example: Class 1 Section: A–G, Class 2 Section: A–H — all sections are auto-created on approval.
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-teal-800 tabular-nums">
                          {draft.classSectionPlan.length} classes · {totalClassSections} total sections
                        </span>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-slate-500 mr-1">Quick fill:</span>
                        {CLASS_PLAN_PRESETS.map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              if (preset.grades.length === 0) {
                                updateClassPlan(DEFAULT_CLASS_SECTION_PLAN);
                              } else {
                                updateClassPlan(
                                  preset.grades.map((grade) => ({
                                    grade,
                                    sectionFrom: preset.from,
                                    sectionTo: preset.to,
                                  })),
                                );
                              }
                            }}
                            className="px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-200 hover:border-teal-500 hover:text-teal-700 rounded-md transition-colors cursor-pointer"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* Selected Class Rows */}
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                        {draft.classSectionPlan.map((row, idx) => {
                          const secCount = expandSectionRange(row.sectionFrom, row.sectionTo).length;
                          const rowOptions = STANDARD_CLASSES.filter(
                            (g) => g === row.grade || !usedGrades.has(g),
                          );
                          return (
                            <div
                              key={`${row.grade}-${idx}`}
                              className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  aria-label={`Class row ${idx + 1}`}
                                  value={row.grade}
                                  onChange={(e) => {
                                    const next = [...draft.classSectionPlan];
                                    next[idx] = { ...next[idx], grade: e.target.value };
                                    updateClassPlan(next);
                                  }}
                                  className="text-xs font-semibold text-slate-900 border border-slate-300 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:border-teal-600"
                                >
                                  {rowOptions.map((g) => (
                                    <option key={g} value={g}>
                                      {g}
                                    </option>
                                  ))}
                                </select>

                                <span className="text-xs text-slate-500">Section:</span>

                                <select
                                  aria-label={`${row.grade} section from`}
                                  value={row.sectionFrom}
                                  onChange={(e) => {
                                    const fromVal = e.target.value;
                                    const next = [...draft.classSectionPlan];
                                    const toVal = fromVal > next[idx].sectionTo ? fromVal : next[idx].sectionTo;
                                    next[idx] = { ...next[idx], sectionFrom: fromVal, sectionTo: toVal };
                                    updateClassPlan(next);
                                  }}
                                  className="text-xs font-mono font-semibold text-slate-900 border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-teal-600"
                                >
                                  {SECTION_LETTERS.map((l) => (
                                    <option key={l} value={l}>
                                      {l}
                                    </option>
                                  ))}
                                </select>

                                <span className="text-xs text-slate-400">to</span>

                                <select
                                  aria-label={`${row.grade} section to`}
                                  value={row.sectionTo}
                                  onChange={(e) => {
                                    const toVal = e.target.value;
                                    const next = [...draft.classSectionPlan];
                                    const fromVal = toVal < next[idx].sectionFrom ? toVal : next[idx].sectionFrom;
                                    next[idx] = { ...next[idx], sectionFrom: fromVal, sectionTo: toVal };
                                    updateClassPlan(next);
                                  }}
                                  className="text-xs font-mono font-semibold text-slate-900 border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-teal-600"
                                >
                                  {SECTION_LETTERS.map((l) => (
                                    <option key={l} value={l}>
                                      {l}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="flex items-center gap-3 ml-auto">
                                <span className="text-xs text-teal-800 font-medium tabular-nums">
                                  {row.grade} {formatSectionRangeLabel(row.sectionFrom, row.sectionTo)} ({secCount})
                                </span>
                                <button
                                  type="button"
                                  disabled={draft.classSectionPlan.length <= 1}
                                  onClick={() => {
                                    const next = draft.classSectionPlan.filter((_, i) => i !== idx);
                                    updateClassPlan(next);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                  aria-label={`Remove ${row.grade}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Add Another Class Selector */}
                      {availableGrades.length > 0 && (
                        <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Choose class to add"
                            value={availableGrades.includes(newClassGrade) ? newClassGrade : availableGrades[0]}
                            onChange={(e) => setNewClassGrade(e.target.value)}
                            className="text-xs font-medium border border-slate-300 rounded-md px-2.5 py-2 bg-white focus:outline-none focus:border-teal-600"
                          >
                            {availableGrades.map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-slate-500">Section:</span>
                          <select
                            aria-label="New class section from"
                            value={newSectionFrom}
                            onChange={(e) => {
                              setNewSectionFrom(e.target.value);
                              if (e.target.value > newSectionTo) setNewSectionTo(e.target.value);
                            }}
                            className="text-xs font-mono border border-slate-300 rounded-md px-2 py-2 bg-white focus:outline-none focus:border-teal-600"
                          >
                            {SECTION_LETTERS.map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-slate-400">to</span>
                          <select
                            aria-label="New class section to"
                            value={newSectionTo}
                            onChange={(e) => {
                              setNewSectionTo(e.target.value);
                              if (e.target.value < newSectionFrom) setNewSectionFrom(e.target.value);
                            }}
                            className="text-xs font-mono border border-slate-300 rounded-md px-2 py-2 bg-white focus:outline-none focus:border-teal-600"
                          >
                            {SECTION_LETTERS.map((l) => (
                              <option key={l} value={l}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const gradeToAdd = availableGrades.includes(newClassGrade)
                                ? newClassGrade
                                : availableGrades[0];
                              if (!gradeToAdd) return;
                              const nextPlan = [
                                ...draft.classSectionPlan,
                                {
                                  grade: gradeToAdd,
                                  sectionFrom: newSectionFrom,
                                  sectionTo: newSectionTo >= newSectionFrom ? newSectionTo : newSectionFrom,
                                },
                              ];
                              updateClassPlan(nextPlan);
                              const remaining = availableGrades.filter((g) => g !== gradeToAdd);
                              if (remaining[0]) setNewClassGrade(remaining[0]);
                            }}
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Class
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Member Counts & School Code Prefix */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          School Code Prefix *
                        </label>
                        <input
                          value={draft.schoolPrefix}
                          onChange={(e) => updateField('schoolPrefix', sanitizeSchoolPrefix(e.target.value))}
                          placeholder={deriveSchoolPrefix(draft.schoolName)}
                          maxLength={6}
                          className="w-full text-sm font-mono uppercase border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">Letters only (e.g. JSS)</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Coordinators *</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={draft.estimatedCoordinators}
                          onChange={(e) => updateField('estimatedCoordinators', sanitizePhoneDigits(e.target.value, 4))}
                          placeholder="6"
                          className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Teachers *</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={draft.estimatedTeachers}
                          onChange={(e) => updateField('estimatedTeachers', sanitizePhoneDigits(e.target.value, 5))}
                          placeholder="20"
                          className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Students *</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={draft.estimatedStudents}
                          onChange={(e) => updateField('estimatedStudents', sanitizePhoneDigits(e.target.value, 6))}
                          placeholder="100"
                          className="w-full text-sm tabular-nums border border-slate-300 rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/15"
                        />
                      </div>
                    </div>

                    {/* Live Role Access Codes Preview */}
                    <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4 space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-teal-900">
                        <KeyRound className="w-4 h-4 text-teal-700 shrink-0" />
                        Auto-Generated Role Access Codes Preview (Prefix: {previewPrefix})
                      </div>
                      <p className="text-[11px] text-teal-800 leading-relaxed">
                        Every role gets separate sequential codes upon approval. When students or staff enter their code
                        during Sign Up, AcademiaOne automatically identifies their school, role, and assigned class.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1 text-xs">
                        <div className="bg-white border border-teal-200/80 rounded-lg p-2.5">
                          <p className="text-[11px] text-slate-500">Principal Login</p>
                          <p className="font-mono font-bold text-slate-900 mt-0.5">{formatPrincipalCode(previewPrefix)}</p>
                        </div>
                        <div className="bg-white border border-teal-200/80 rounded-lg p-2.5">
                          <p className="text-[11px] text-slate-500">Coordinators ({coordCount})</p>
                          <p className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
                            {formatRoleCodeRange(previewPrefix, 'coordinator', coordCount)}
                          </p>
                        </div>
                        <div className="bg-white border border-teal-200/80 rounded-lg p-2.5">
                          <p className="text-[11px] text-slate-500">Teachers ({teacherCount})</p>
                          <p className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
                            {formatRoleCodeRange(previewPrefix, 'teacher', teacherCount)}
                          </p>
                        </div>
                        <div className="bg-white border border-teal-200/80 rounded-lg p-2.5">
                          <p className="text-[11px] text-slate-500">Students ({studentCount})</p>
                          <p className="font-mono font-bold text-slate-900 mt-0.5 tabular-nums">
                            {formatRoleCodeRange(previewPrefix, 'student', studentCount)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* STEP 6: REVIEW & SUBMIT */}
              {step === 6 && (
                <>
                  <div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      Step 6 — Review, Consent & Submission
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Verify every section before submitting to Main Head. Click Edit on any block to adjust details
                      without losing your entries.
                    </p>
                  </div>

                  {/* Free Forever Notice */}
                  <div className="p-4 rounded-xl bg-teal-50/70 border border-teal-200 flex items-start gap-3">
                    <Sparkles className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-semibold text-teal-900">100% Free Unlimited Campus Access</p>
                      <p className="text-teal-800 mt-0.5">
                        All portals, attendance registers, timetables, exams, homework, announcements, and reports are completely free for your school with no billing or subscription fees.
                      </p>
                    </div>
                  </div>

                  <motion.div
                    variants={getStaggerContainerVariants(prefersReducedMotion, 0.05)}
                    initial="hidden"
                    animate="visible"
                    className="space-y-3 text-xs"
                  >
                    {[
                      {
                        stepNum: 1,
                        title: 'Signed-In Account & Applicant',
                        lines: [
                          `${draft.applicantName} (${draft.applicantDesignation})`,
                          `${effectiveApplicantEmail} · ${draft.applicantPhone}`,
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
                          [draft.address, draft.city, draft.stateRegion, draft.postalCode, draft.country]
                            .filter(Boolean)
                            .join(', '),
                          `${draft.schoolEmail} · ${draft.schoolPhone}`,
                        ],
                      },
                      {
                        stepNum: 4,
                        title: 'Principal & Portal Access',
                        lines: [
                          `${effectivePrincipalName} · ${effectivePrincipalEmail} · ${effectivePrincipalPhone || '—'}`,
                          `Preferred Login: ${draft.authMethod === 'google' ? 'Google Sign-In' : 'Email & Password'} (both supported after approval)`,
                        ],
                      },
                      {
                        stepNum: 5,
                        title: 'Classes, Sections & Role Access Codes',
                        lines: [
                          `Academic Year ${draft.academicYear} · Prefix: ${effectivePrefix || 'SCH'} · Principal Code: ${formatPrincipalCode(effectivePrefix || 'SCH')}`,
                          `Classes (${countTotalClassSections(draft.classSectionPlan)} sections): ${formatClassSectionPlanSummary(draft.classSectionPlan)}`,
                          `Code Allocation: ${draft.estimatedCoordinators || 0} Coordinators · ${draft.estimatedTeachers || 0} Teachers · ${draft.estimatedStudents || 0} Students`,
                        ],
                      },
                    ].map((group) => (
                      <motion.div
                        key={group.stepNum}
                        variants={getStaggerItemVariants(prefersReducedMotion, 8)}
                        className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-4 bg-white hover:border-slate-300 transition-colors"
                      >
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
                          onClick={() => navigateStep(group.stepNum)}
                          className="inline-flex items-center gap-1 text-teal-700 hover:text-teal-800 font-semibold shrink-0 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                      </motion.div>
                    ))}
                  </motion.div>

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

          <AnimatePresence>
            {stepError && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: MOTION_EASE.out }}
                role="alert"
                className="mt-5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
              >
                {stepError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Wizard Footer Actions */}
          <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-between gap-3">
            <Button variant="secondary" onClick={goBack} disabled={step === 1 || submitting}>
              <ArrowLeft className="w-4 h-4" /> Back
            </Button>

            {step < TOTAL_STEPS ? (
              <Button variant="navy" onClick={goNext} disabled={step === 1 && !firebaseUser}>
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="primary" loading={submitting} onClick={handleFinalSubmit}>
                {submitting ? 'Submitting Application…' : 'Submit School Application'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

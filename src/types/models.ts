export type UserRole = 'main_head' | 'principal' | 'coordinator' | 'teacher' | 'student';
export type AccountStatus = 'active' | 'inactive' | 'suspended';
export type SchoolStatus = 'active' | 'trial' | 'suspended' | 'archived';
export type SubscriptionStatus = 'active' | 'trial' | 'grace_readonly' | 'expired' | 'cancelled';
export type NotificationCategory = 'messages' | 'task_reminders' | 'academic' | 'special_offers' | 'system';
export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

export interface CoordinatorPermissions {
  canEditAttendance: boolean;
  canEditMarks: boolean;
  canAssignTeachers: boolean;
  canPublishNotices: boolean;
  canCoordinateExams: boolean;
}

export interface PlatformUser {
  uid: string;
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
  schoolId: string;
  status: AccountStatus;
  mustChangePassword: boolean;
  phone?: string;
  classId?: string;
  section?: string;
  assignedClassIds?: string[];
  assignedSubjectIds?: string[];
  coordinatorPermissions?: CoordinatorPermissions;
  accessCode?: string;
  isDemo?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PeriodTimingSlot {
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak?: boolean;
}

export interface School {
  id: string;
  name: string;
  code: string;
  address?: string;
  email?: string;
  phone?: string;
  academicYear: string;
  status: SchoolStatus;
  principalUid?: string;
  principalUsername?: string;
  principalName?: string;
  principalEmail?: string;
  subscriptionPlanId: string;
  subscriptionStatus: 'active' | 'trial' | 'grace_readonly' | 'expired';
  subscriptionStart?: string;
  subscriptionEnd?: string;
  coordinatorCount?: number;
  teacherCount?: number;
  studentCount?: number;
  allocatedCoordinators?: number;
  allocatedTeachers?: number;
  allocatedStudents?: number;
  settings?: {
    allowOnlineHomeworkSubmission?: boolean;
    attendanceEditWindowHours?: number;
    gradingScale?: string;
    workingDays?: DayOfWeek[];
    periodsPerDay?: number;
    periodSchedule?: PeriodTimingSlot[];
    campusLatitude?: number;
    campusLongitude?: number;
    attendanceGeofenceMeters?: number;
  };
  source?: 'public_application' | 'admin_manual' | 'demo_seed';
  schoolType?: string;
  board?: string;
  logoDataUrl?: string;
  schoolPrefix?: string;
  activationCode?: string;
  activationVerified?: boolean;
  setupCompleted?: boolean;
  isDemo?: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: 'free' | 'basic' | 'standard' | 'premium';
  priceMonthly: number;
  billingInterval: 'monthly' | 'quarterly' | 'annual';
  trialDays: number;
  maxStudents: number;
  maxTeachers: number;
  storageGb: number;
  enabledModules: string[];
  status: 'active' | 'archived';
  description?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RenewalRecord {
  date: string;
  planName: string;
  amount: number;
  paymentMode: 'manual' | 'online_pending';
  reference: string;
  recordedBy: string;
}

export interface SchoolSubscription {
  id: string;
  schoolId: string;
  schoolName?: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string;
  paymentMode: 'manual' | 'online_pending';
  paymentStatus: 'paid_manual' | 'pending' | 'overdue' | 'trial';
  paymentReference?: string;
  amount: number;
  renewalHistory?: RenewalRecord[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SchoolEnquiry {
  id: string;
  schoolName: string;
  contactName: string;
  email: string;
  phone?: string;
  estimatedStudents?: number;
  message?: string;
  status: 'new' | 'contacted' | 'converted' | 'dismissed';
  createdAt?: unknown;
}

export interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  supportPhone?: string;
  allowPublicRegistration: boolean;
  defaultTrialDays: number;
  sessionTimeoutMinutes: number;
  paymentGatewayStatus?: string;
  fcmStatus?: string;
  updatedBy?: string;
  updatedAt?: unknown;
}

export interface SchoolClass {
  id: string;
  schoolId: string;
  name: string;
  gradeLevel: string;
  section: string;
  code: string;
  academicYear: string;
  capacity: number;
  classTeacherId?: string;
  classTeacherName?: string;
  roomId?: string;
  roomName?: string;
  status: 'active' | 'archived';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Subject {
  id: string;
  schoolId: string;
  name: string;
  code: string;
  classId: string;
  className?: string;
  teacherId?: string;
  teacherName?: string;
  status: 'active' | 'archived';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Room {
  id: string;
  schoolId: string;
  roomNumber: string;
  name: string;
  building: string;
  capacity: number;
  roomType: 'classroom' | 'science_lab' | 'computer_lab' | 'exam_hall' | 'auditorium';
  available: boolean;
  status: 'active' | 'maintenance' | 'inactive';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TeacherProfile {
  id: string;
  schoolId: string;
  userId?: string;
  staffId: string;
  name: string;
  email: string;
  phone?: string;
  subjects?: string[];
  qualifications?: string;
  joiningDate?: string;
  assignedClassIds?: string[];
  classTeacherOfClassId?: string;
  accessCode?: string;
  status: 'active' | 'on_leave' | 'inactive';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentHistoryEntry {
  date: string;
  event: string;
  fromClass?: string;
  toClass?: string;
  academicYear?: string;
}

export interface StudentProfile {
  id: string;
  schoolId: string;
  userId?: string;
  admissionNumber: string;
  rollNumber: string;
  name: string;
  email?: string;
  classId: string;
  className: string;
  section: string;
  academicYear: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  accessCode?: string;
  status: 'active' | 'promoted' | 'transferred' | 'withdrawn' | 'inactive';
  history?: StudentHistoryEntry[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TimetablePeriod {
  id: string;
  schoolId: string;
  classId: string;
  className?: string;
  dayOfWeek: DayOfWeek;
  periodNumber: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  subjectId?: string;
  subjectName?: string;
  teacherId?: string;
  teacherName?: string;
  roomId?: string;
  roomName?: string;
  status: 'published' | 'draft';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceEntry {
  studentId: string;
  studentName: string;
  rollNumber: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  note?: string;
}

export interface AttendanceRecord {
  id: string;
  schoolId: string;
  classId: string;
  className?: string;
  date: string;
  teacherId?: string;
  status: 'draft' | 'submitted';
  entries: AttendanceEntry[];
  editHistory?: { editedBy: string; editedAt: string; note: string }[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TeacherAttendanceRecord {
  id: string;
  schoolId: string;
  teacherId: string;
  teacherUid?: string;
  teacherName: string;
  staffId?: string;
  date: string;
  status: 'present' | 'late' | 'half_day' | 'absent' | 'on_leave';
  checkInTime?: string;
  latitude?: number;
  longitude?: number;
  distanceMeters?: number;
  withinRange?: boolean;
  photoDataUrl?: string;
  markedBy: 'teacher' | 'principal';
  markedByUid: string;
  markedByName: string;
  notes?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Homework {
  id: string;
  schoolId: string;
  classId: string;
  className?: string;
  subjectId?: string;
  subjectName: string;
  teacherId?: string;
  teacherName?: string;
  title: string;
  instructions?: string;
  assignedDate: string;
  dueDate: string;
  allowOnlineSubmission?: boolean;
  attachmentName?: string;
  status: 'published' | 'draft' | 'closed';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface HomeworkSubmission {
  id: string;
  schoolId: string;
  homeworkId: string;
  classId: string;
  studentId: string;
  studentUid?: string;
  studentName: string;
  fileName?: string;
  fileType?: string;
  fileSizeKb?: number;
  submissionText?: string;
  submittedAt?: string;
  isLate?: boolean;
  reviewStatus: 'submitted' | 'reviewed' | 'needs_correction' | 'completed';
  feedback?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Examination {
  id: string;
  schoolId: string;
  name: string;
  category: 'unit_test' | 'midterm' | 'final' | 'practical';
  academicYear: string;
  classId: string;
  className?: string;
  subjectId?: string;
  subjectName: string;
  date: string;
  startTime: string;
  endTime: string;
  maxMarks: number;
  passingMarks: number;
  roomId?: string;
  roomName?: string;
  schedulePublished: boolean;
  resultsPublished: boolean;
  status: 'scheduled' | 'completed' | 'cancelled';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ExamResult {
  id: string;
  schoolId: string;
  examId: string;
  examName?: string;
  classId: string;
  subjectName?: string;
  studentId: string;
  studentUid?: string;
  studentName: string;
  maxMarks: number;
  passingMarks: number;
  obtainedMarks: number;
  grade?: string;
  remarks?: string;
  status: 'draft' | 'submitted' | 'published';
  auditHistory?: { updatedBy: string; updatedAt: string; previousMarks: number; newMarks: number }[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LearningMaterial {
  id: string;
  schoolId: string;
  classId: string;
  className?: string;
  subjectName: string;
  teacherId?: string;
  teacherName?: string;
  title: string;
  topic?: string;
  description?: string;
  fileName: string;
  fileType: 'PDF' | 'DOCX' | 'PNG' | 'JPG' | 'SLIDES' | 'NOTE';
  fileSizeKb?: number;
  contentPreview?: string;
  status: 'published' | 'archived';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Announcement {
  id: string;
  schoolId: string;
  title: string;
  body: string;
  audience: 'school_wide' | 'class_specific' | 'role_specific' | 'principal_flag';
  targetClassId?: string;
  targetRole?: string;
  attachmentName?: string;
  authorId: string;
  authorName: string;
  authorRole: 'main_head' | 'principal' | 'coordinator' | 'teacher';
  status: 'published' | 'scheduled' | 'archived';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AppNotification {
  id: string;
  userId: string;
  schoolId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  linkRoute?: string;
  isRead: boolean;
  createdAt?: unknown;
}

export interface NotificationPreferences {
  userId: string;
  browserPushEnabled: boolean;
  inAppEnabled: boolean;
  messages: boolean;
  task_reminders: boolean;
  academic: boolean;
  special_offers: boolean;
  system: boolean;
  updatedAt?: unknown;
}

export interface AuditLog {
  id: string;
  schoolId: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel?: string;
  details?: string;
  createdAt?: unknown;
}

export type SchoolApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'more_info_required'
  | 'approved'
  | 'rejected'
  | 'withdrawn';

export interface ApplicationActivityEntry {
  at: string;
  actor: string;
  action: string;
  note?: string;
}

export interface SchoolApplication {
  id: string;
  applicationNumber: string;
  applicantUid?: string;
  applicantName: string;
  applicantDesignation?: string;
  applicantEmail: string;
  applicantPhone?: string;
  organizationName?: string;
  preferredContactMethod?: string;
  authorityRelationship?: string;
  applicantIsPrincipal?: boolean;
  contactVerified?: boolean;
  schoolName: string;
  displayName?: string;
  institutionType?: string;
  affiliationBoard?: string;
  mediumOfInstruction?: string;
  establishedYear?: string;
  externalRecognitionCode?: string;
  logoDataUrl?: string;
  academicYear: string;
  website?: string;
  schoolEmail: string;
  schoolPhone?: string;
  alternateContact?: string;
  country?: string;
  stateRegion?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  address: string;
  campusAddress?: string;
  classesOffered?: string;
  classSectionPlan?: ClassSectionRange[];
  schoolPrefix?: string;
  estimatedCoordinators?: number;
  estimatedStudents?: number;
  estimatedTeachers?: number;
  workingDaysSummary?: string;
  principalName: string;
  principalEmail: string;
  principalPhone?: string;
  principalDesignation?: string;
  authMethod: 'email_password' | 'google';
  requestedPlanId: string;
  consentPolicyVersion?: string;
  status: SchoolApplicationStatus;
  internalNotes?: string;
  applicantMessage?: string;
  decisionNote?: string;
  approvedSchoolId?: string;
  approvedSchoolCode?: string;
  reviewedBy?: string;
  activityLog?: ApplicationActivityEntry[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ApplicationStatusRecord {
  applicationNumber: string;
  type: 'school' | 'member';
  verificationEmailHash?: string;
  schoolId?: string;
  schoolName: string;
  requestedRole: 'principal' | 'coordinator' | 'teacher' | 'student';
  status: SchoolApplicationStatus | 'pending';
  schoolCode?: string;
  applicantMessage?: string;
  decisionNote?: string;
  applicantResponseNote?: string;
  submittedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClassSectionRange {
  grade: string;
  sectionFrom: string;
  sectionTo: string;
}

export interface SchoolCodeClassSlot {
  classId: string;
  classCode?: string;
  className: string;
  gradeLevel: string;
  section: string;
}

export interface SchoolCodeEntry {
  code: string;
  schoolId: string;
  schoolName: string;
  status: SchoolStatus;
  principalCode?: string;
  coordinatorCount?: number;
  teacherCount?: number;
  studentCount?: number;
  classSections?: SchoolCodeClassSlot[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MemberAccessCode {
  code: string;
  schoolId: string;
  schoolCode: string;
  schoolName: string;
  role: 'coordinator' | 'teacher' | 'student';
  memberName: string;
  email?: string;
  classId?: string;
  classCode?: string;
  className?: string;
  teacherId?: string;
  teacherCode?: string;
  teacherName?: string;
  rollNumber?: string;
  status: 'active' | 'claimed' | 'revoked';
  linkedProfileId?: string;
  linkedUid?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EmailDirectoryEntry {
  emailKey: string;
  email: string;
  schoolId: string;
  schoolName?: string;
  role: 'principal' | 'coordinator' | 'teacher' | 'student';
  displayName?: string;
  accessCode?: string;
  linkedProfileId?: string;
  classId?: string;
  section?: string;
  assignedClassIds?: string[];
  coordinatorPermissions?: CoordinatorPermissions;
  status: 'active' | 'inactive';
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type JoinApprovalStage =
  | 'teacher_pending'
  | 'coordinator_pending'
  | 'principal_pending'
  | 'approved'
  | 'rejected';

export interface SchoolJoinRequest {
  id: string;
  applicationNumber: string;
  schoolId: string;
  schoolCode: string;
  accessCode?: string;
  classCode?: string;
  teacherCode?: string;
  studentCode?: string;
  targetTeacherId?: string;
  targetTeacherUid?: string;
  targetTeacherName?: string;
  schoolName: string;
  applicantUid: string;
  applicantEmail: string;
  applicantName: string;
  phone?: string;
  requestedRole: 'coordinator' | 'teacher' | 'student';
  requestedClassId?: string;
  requestedSection?: string;
  requestedClassInfo?: string;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  approvalStage?: JoinApprovalStage;
  teacherApprovedBy?: string;
  teacherApprovedName?: string;
  teacherApprovedAt?: string;
  coordinatorApprovedBy?: string;
  coordinatorApprovedName?: string;
  coordinatorApprovedAt?: string;
  principalApprovedBy?: string;
  principalApprovedAt?: string;
  decisionNote?: string;
  reviewedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}


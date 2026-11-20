/**
 * Security Rules Verification Specification Runner
 * Verifies all 12 "Dirty Dozen" adversarial payloads defined in security_spec.md
 * against firestore.rules when executed with @firebase/rules-unit-testing and Firestore Emulator.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  actor: { uid: string; email: string; email_verified: boolean; role: string; schoolId: string };
  operation: 'create' | 'update' | 'delete' | 'get' | 'list';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Self-Privilege Escalation on Signup',
    actor: { uid: 'u_attacker', email: 'attacker@example.com', email_verified: true, role: 'student', schoolId: 'unassigned' },
    operation: 'create',
    path: '/users/u_attacker',
    payload: { uid: 'u_attacker', username: 'atk', email: 'attacker@example.com', displayName: 'Attacker', role: 'main_head', schoolId: 'platform', status: 'active', mustChangePassword: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self Role Mutation Attack',
    actor: { uid: 'u_teacher_1', email: 't1@northridge.edu', email_verified: true, role: 'teacher', schoolId: 'school_northridge' },
    operation: 'update',
    path: '/users/u_teacher_1',
    payload: { role: 'principal' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-Tenant Student Read',
    actor: { uid: 'u_principal_nr', email: 'principal@northridge.edu', email_verified: true, role: 'principal', schoolId: 'school_northridge' },
    operation: 'get',
    path: '/students/stu_cv_01',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-Tenant Class Creation',
    actor: { uid: 'u_principal_nr', email: 'principal@northridge.edu', email_verified: true, role: 'principal', schoolId: 'school_northridge' },
    operation: 'create',
    path: '/classes/cls_injected',
    payload: { id: 'cls_injected', schoolId: 'school_crestview', name: 'Grade 10-A', gradeLevel: '10', section: 'A', code: 'G10A', academicYear: '2026-2027', capacity: 30, status: 'active', createdBy: 'u_principal_nr' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Field Injection',
    actor: { uid: 'u_principal_nr', email: 'principal@northridge.edu', email_verified: true, role: 'principal', schoolId: 'school_northridge' },
    operation: 'update',
    path: '/classes/cls_nr_10a',
    payload: { capacity: 35, isVerifiedAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unverified Admin Email Spoofing',
    actor: { uid: 'u_spoof', email: 'sjtutorai@gmail.com', email_verified: false, role: 'student', schoolId: 'unassigned' },
    operation: 'update',
    path: '/schools/school_northridge',
    payload: { status: 'suspended' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Student Attendance Tampering',
    actor: { uid: 'u_student_nr', email: 'stu@northridge.edu', email_verified: true, role: 'student', schoolId: 'school_northridge' },
    operation: 'update',
    path: '/attendanceRecords/att_nr_01',
    payload: { status: 'submitted', entries: [] },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Exam Marks Overflow Above MaxMarks',
    actor: { uid: 'u_teacher_1', email: 't1@northridge.edu', email_verified: true, role: 'teacher', schoolId: 'school_northridge' },
    operation: 'create',
    path: '/examResults/res_overflow',
    payload: { id: 'res_overflow', schoolId: 'school_northridge', examId: 'ex_1', classId: 'cls_nr_10a', studentId: 'stu_1', studentName: 'Aarav', maxMarks: 100, passingMarks: 40, obtainedMarks: 150, status: 'draft', createdBy: 'u_teacher_1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Audit Log Deletion Attempt',
    actor: { uid: 'u_principal_nr', email: 'principal@northridge.edu', email_verified: true, role: 'principal', schoolId: 'school_northridge' },
    operation: 'delete',
    path: '/auditLogs/log_01',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'PII Cross-User Preference Read',
    actor: { uid: 'u_student_nr', email: 'stu@northridge.edu', email_verified: true, role: 'student', schoolId: 'school_northridge' },
    operation: 'get',
    path: '/notificationPreferences/u_student_other',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Oversized Document ID Poisoning',
    actor: { uid: 'u_principal_nr', email: 'principal@northridge.edu', email_verified: true, role: 'principal', schoolId: 'school_northridge' },
    operation: 'create',
    path: `/announcements/${'a'.repeat(200)}`,
    payload: { id: 'a'.repeat(200), schoolId: 'school_northridge', title: 'Spam', body: 'Test', audience: 'school_wide', authorId: 'u_principal_nr', authorName: 'Principal', authorRole: 'principal', status: 'published' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Forged Enquiry Timestamp',
    actor: { uid: 'anon', email: '', email_verified: false, role: 'public', schoolId: '' },
    operation: 'create',
    path: '/schoolEnquiries/enq_forged',
    payload: { id: 'enq_forged', schoolName: 'Fake', contactName: 'Bot', email: 'bot@example.com', status: 'new', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Student Join Stage Skipping (Bypassing Teacher & Coordinator)',
    actor: { uid: 'u_principal_nr', email: 'principal@northridge.edu', email_verified: true, role: 'principal', schoolId: 'school_northridge' },
    operation: 'update',
    path: '/schoolJoinRequests/jreq_student_stage1',
    payload: { status: 'approved', approvalStage: 'approved' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Unauthorized Member Access Code Issuance by Teacher',
    actor: { uid: 'u_teacher_1', email: 't1@northridge.edu', email_verified: true, role: 'teacher', schoolId: 'school_northridge' },
    operation: 'create',
    path: '/memberAccessCodes/NRPC99',
    payload: { code: 'NRPC99', schoolId: 'school_northridge', schoolCode: 'NRP', schoolName: 'Northridge Prep', role: 'coordinator', memberName: 'Fake Coord', status: 'active', createdBy: 'u_teacher_1' },
    expected: 'PERMISSION_DENIED',
  },
];


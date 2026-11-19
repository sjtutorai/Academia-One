import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { emailToKey, hashVerificationEmail } from './schoolProvisioning';

export const DEMO_SCHOOL_IDS = ['school_northridge', 'school_crestview'] as const;

export const DEMO_ACCOUNTS = [
  {
    uid: 'demo_principal_nr',
    username: 'principal.northridge',
    email: 'principal.northridge@academiaone.edu',
    displayName: 'Dr. Eleanor Vance',
    role: 'principal' as const,
    schoolId: 'school_northridge',
    schoolName: 'Northridge Preparatory Academy',
  },
  {
    uid: 'demo_coord_nr',
    username: 'coord.northridge',
    email: 'coord.northridge@academiaone.edu',
    displayName: 'Marcus Chen',
    role: 'coordinator' as const,
    schoolId: 'school_northridge',
    schoolName: 'Northridge Preparatory Academy',
    assignedClassIds: ['cls_nr_10a', 'cls_nr_10b'],
  },
  {
    uid: 'demo_teacher_nr',
    username: 'teacher.northridge',
    email: 'teacher.northridge@academiaone.edu',
    displayName: 'Prof. Elena Rostova',
    role: 'teacher' as const,
    schoolId: 'school_northridge',
    schoolName: 'Northridge Preparatory Academy',
    assignedClassIds: ['cls_nr_10a', 'cls_nr_10b'],
    assignedSubjectIds: ['sub_nr_math_10a', 'sub_nr_math_10b'],
  },
  {
    uid: 'demo_student_nr',
    username: 'student.northridge',
    email: 'student.northridge@academiaone.edu',
    displayName: 'Aarav Mehta',
    role: 'student' as const,
    schoolId: 'school_northridge',
    schoolName: 'Northridge Preparatory Academy',
    classId: 'cls_nr_10a',
    section: 'A',
  },
  {
    uid: 'demo_principal_cv',
    username: 'principal.crestview',
    email: 'principal.crestview@academiaone.edu',
    displayName: 'Dr. Rajesh Kapoor',
    role: 'principal' as const,
    schoolId: 'school_crestview',
    schoolName: 'Crestview International School',
  },
  {
    uid: 'demo_teacher_cv',
    username: 'teacher.crestview',
    email: 'teacher.crestview@academiaone.edu',
    displayName: 'Ms. Clara Lindqvist',
    role: 'teacher' as const,
    schoolId: 'school_crestview',
    schoolName: 'Crestview International School',
    assignedClassIds: ['cls_cv_9a'],
    assignedSubjectIds: ['sub_cv_bio_9a'],
  },
  {
    uid: 'demo_student_cv',
    username: 'student.crestview',
    email: 'student.crestview@academiaone.edu',
    displayName: 'Zara Al-Mansoor',
    role: 'student' as const,
    schoolId: 'school_crestview',
    schoolName: 'Crestview International School',
    classId: 'cls_cv_9a',
    section: 'A',
  },
];

export async function seedDemoEcosystem(actorUid: string, actorName: string): Promise<void> {
  const now = serverTimestamp();
  const batch1 = writeBatch(db);

  // 1. Platform Settings
  batch1.set(doc(db, 'platformSettings', 'global'), {
    platformName: 'AcademiaOne',
    supportEmail: 'support@academiaone.edu',
    supportPhone: '+1 (800) 555-0199',
    allowPublicRegistration: true,
    defaultTrialDays: 14,
    sessionTimeoutMinutes: 60,
    paymentGatewayStatus: 'pending_configuration',
    fcmStatus: 'browser_push_active_fcm_pending',
    updatedBy: actorUid,
    updatedAt: now,
  });

  // 2. Subscription Plans
  const plans = [
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
      maxStudents: 400,
      maxTeachers: 35,
      storageGb: 25,
      enabledModules: ['attendance', 'timetable', 'homework', 'announcements', 'reports'],
      status: 'active',
      description: 'Core daily administration for growing independent schools.',
    },
    {
      id: 'plan_standard',
      name: 'Standard Academic',
      tier: 'standard',
      priceMonthly: 249,
      billingInterval: 'monthly',
      trialDays: 14,
      maxStudents: 1500,
      maxTeachers: 120,
      storageGb: 100,
      enabledModules: ['attendance', 'timetable', 'homework', 'examinations', 'materials', 'csv_import', 'announcements', 'reports'],
      status: 'active',
      description: 'Full examination, timetable conflict guard, and coordinator oversight.',
    },
    {
      id: 'plan_premium',
      name: 'Premium Multi-Campus',
      tier: 'premium',
      priceMonthly: 499,
      billingInterval: 'annual',
      trialDays: 30,
      maxStudents: 5000,
      maxTeachers: 400,
      storageGb: 500,
      enabledModules: ['attendance', 'timetable', 'homework', 'examinations', 'materials', 'csv_import', 'announcements', 'reports', 'priority_support', 'audit_exports'],
      status: 'active',
      description: 'High-capacity campuses with audit exports and unlimited coordinator scopes.',
    },
  ];
  for (const p of plans) {
    batch1.set(doc(db, 'subscriptionPlans', p.id), { ...p, createdAt: now, updatedAt: now });
  }

  // 3. Two Independent Demo Schools
  batch1.set(doc(db, 'schools', 'school_northridge'), {
    id: 'school_northridge',
    name: 'Northridge Preparatory Academy',
    code: 'NRP',
    address: '420 Academic Way, Portland, OR 97204',
    email: 'office@northridge.edu',
    phone: '+1 (503) 555-0142',
    academicYear: '2026-2027',
    status: 'active',
    principalUid: 'demo_principal_nr',
    principalUsername: 'principal.northridge',
    principalName: 'Dr. Eleanor Vance',
    principalEmail: 'principal.northridge@academiaone.edu',
    subscriptionPlanId: 'plan_standard',
    subscriptionStatus: 'active',
    subscriptionStart: '2026-09-01',
    subscriptionEnd: '2027-08-31',
    teacherCount: 3,
    studentCount: 6,
    settings: {
      allowOnlineHomeworkSubmission: true,
      attendanceEditWindowHours: 24,
      gradingScale: 'A+ to F (Standard)',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    },
    isDemo: true,
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch1.set(doc(db, 'schools', 'school_crestview'), {
    id: 'school_crestview',
    name: 'Crestview International School',
    code: 'CVI',
    address: '88 Harbor Terrace, Bellevue, WA 98004',
    email: 'admin@crestview.edu',
    phone: '+1 (425) 555-0188',
    academicYear: '2026-2027',
    status: 'trial',
    principalUid: 'demo_principal_cv',
    principalUsername: 'principal.crestview',
    principalName: 'Dr. Rajesh Kapoor',
    principalEmail: 'principal.crestview@academiaone.edu',
    subscriptionPlanId: 'plan_premium',
    subscriptionStatus: 'trial',
    subscriptionStart: '2026-11-01',
    subscriptionEnd: '2026-12-01',
    teacherCount: 2,
    studentCount: 4,
    settings: {
      allowOnlineHomeworkSubmission: true,
      attendanceEditWindowHours: 48,
      gradingScale: 'IB / Percentage Hybrid',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    },
    isDemo: true,
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  // 4. School Subscriptions
  batch1.set(doc(db, 'schoolSubscriptions', 'sub_northridge_2026'), {
    id: 'sub_northridge_2026',
    schoolId: 'school_northridge',
    schoolName: 'Northridge Preparatory Academy',
    planId: 'plan_standard',
    planName: 'Standard Academic',
    status: 'active',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    paymentMode: 'manual',
    paymentStatus: 'paid_manual',
    paymentReference: 'INV-2026-NRP-0091',
    amount: 2988,
    renewalHistory: [
      {
        date: '2026-09-01',
        planName: 'Standard Academic',
        amount: 2988,
        paymentMode: 'manual',
        reference: 'INV-2026-NRP-0091',
        recordedBy: actorName,
      },
    ],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch1.set(doc(db, 'schoolSubscriptions', 'sub_crestview_2026'), {
    id: 'sub_crestview_2026',
    schoolId: 'school_crestview',
    schoolName: 'Crestview International School',
    planId: 'plan_premium',
    planName: 'Premium Multi-Campus',
    status: 'trial',
    startDate: '2026-11-01',
    endDate: '2026-12-01',
    paymentMode: 'online_pending',
    paymentStatus: 'trial',
    paymentReference: 'TRIAL-CVI-30D',
    amount: 0,
    renewalHistory: [
      {
        date: '2026-11-01',
        planName: 'Premium Multi-Campus (30-Day Trial)',
        amount: 0,
        paymentMode: 'manual',
        reference: 'TRIAL-CVI-30D',
        recordedBy: actorName,
      },
    ],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  // 5. Demo Users (Profiles for all 5 roles across 2 schools)
  for (const acc of DEMO_ACCOUNTS) {
    batch1.set(doc(db, 'users', acc.uid), {
      uid: acc.uid,
      username: acc.username,
      email: acc.email,
      displayName: acc.displayName,
      role: acc.role,
      schoolId: acc.schoolId,
      status: 'active',
      mustChangePassword: false,
      phone: acc.schoolId === 'school_northridge' ? '+1 (503) 555-0190' : '+1 (425) 555-0194',
      classId: 'classId' in acc ? acc.classId : '',
      section: 'section' in acc ? acc.section : '',
      assignedClassIds: 'assignedClassIds' in acc ? acc.assignedClassIds : [],
      assignedSubjectIds: 'assignedSubjectIds' in acc ? acc.assignedSubjectIds : [],
      coordinatorPermissions:
        acc.role === 'coordinator'
          ? {
              canEditAttendance: true,
              canEditMarks: false,
              canAssignTeachers: false,
              canPublishNotices: true,
              canCoordinateExams: true,
            }
          : {},
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 6. Demo School Enquiry
  batch1.set(doc(db, 'schoolEnquiries', 'enq_demo_oakwood'), {
    id: 'enq_demo_oakwood',
    schoolName: 'Oakwood Science Magnet',
    contactName: 'Dr. Miriam Alcott',
    email: 'malcott@oakwoodmagnet.edu',
    phone: '+1 (206) 555-0174',
    estimatedStudents: 640,
    message: 'Looking to migrate 24 sections from legacy spreadsheets before the spring semester.',
    status: 'new',
    createdAt: now,
  });

  // 7. School Codes for Demo Schools (for /join-school testing)
  batch1.set(doc(db, 'schoolCodes', 'NRP'), {
    code: 'NRP',
    schoolId: 'school_northridge',
    schoolName: 'Northridge Preparatory Academy',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  batch1.set(doc(db, 'schoolCodes', 'CVI'), {
    code: 'CVI',
    schoolId: 'school_crestview',
    schoolName: 'Crestview International School',
    status: 'trial',
    createdAt: now,
    updatedAt: now,
  });

  // 8. Email Directory entries for all demo accounts
  for (const acc of DEMO_ACCOUNTS) {
    const key = emailToKey(acc.email);
    batch1.set(doc(db, 'emailDirectory', key), {
      emailKey: key,
      email: acc.email.toLowerCase(),
      schoolId: acc.schoolId,
      schoolName: acc.schoolName,
      role: acc.role,
      displayName: acc.displayName,
      linkedProfileId: '',
      classId: 'classId' in acc ? acc.classId : '',
      section: 'section' in acc ? acc.section : '',
      assignedClassIds: 'assignedClassIds' in acc ? acc.assignedClassIds : [],
      status: 'active',
      createdBy: actorUid,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 9. Sample Pending 7-Step School Application + Status Tracker (SCH-2026-DEMO01)
  const demoAppEmail = 'principal@oakwoodmagnet.edu';
  const demoEmailHash = await hashVerificationEmail(demoAppEmail);
  batch1.set(doc(db, 'schoolApplications', 'app_demo_oakwood'), {
    id: 'app_demo_oakwood',
    applicationNumber: 'SCH-2026-DEMO01',
    applicantName: 'Dr. Miriam Alcott',
    applicantDesignation: 'Principal & Head of School',
    applicantEmail: demoAppEmail,
    applicantPhone: '+1 (206) 555-0175',
    organizationName: 'Oakwood Educational Trust',
    preferredContactMethod: 'Email',
    authorityRelationship: 'Principal',
    applicantIsPrincipal: true,
    contactVerified: true,
    schoolName: 'Oakwood Science Magnet Academy',
    displayName: 'Oakwood Magnet',
    institutionType: 'Private Independent',
    affiliationBoard: 'CBSE / STEM Magnet',
    mediumOfInstruction: 'English',
    establishedYear: '2014',
    externalRecognitionCode: 'WA-EDU-2014-8821',
    logoDataUrl: '',
    academicYear: '2026-2027',
    website: 'https://oakwoodmagnet.edu',
    schoolEmail: 'admissions@oakwoodmagnet.edu',
    schoolPhone: '+1 (206) 555-0174',
    alternateContact: 'Hannah Brooks (Registrar)',
    country: 'United States',
    stateRegion: 'WA',
    district: 'King County',
    city: 'Seattle',
    postalCode: '98109',
    address: '510 Innovation Drive, Seattle, WA 98109',
    campusAddress: '510 Innovation Drive',
    classesOffered: 'Grades 6–12',
    estimatedStudents: 640,
    estimatedTeachers: 48,
    workingDaysSummary: 'Monday to Friday · 08:15 AM – 03:15 PM',
    principalName: 'Dr. Miriam Alcott',
    principalEmail: demoAppEmail,
    principalPhone: '+1 (206) 555-0175',
    principalDesignation: 'Principal & Head of School',
    authMethod: 'email_password',
    requestedPlanId: 'plan_standard',
    consentPolicyVersion: '2026.1',
    status: 'submitted',
    internalNotes: '',
    applicantMessage: 'Your school application has been submitted and is awaiting Main Head review.',
    decisionNote: '',
    approvedSchoolId: '',
    approvedSchoolCode: '',
    reviewedBy: '',
    activityLog: [
      {
        at: new Date().toISOString(),
        actor: 'Dr. Miriam Alcott',
        action: 'SUBMITTED',
        note: 'Submitted public 7-step school registration application.',
      },
    ],
    createdAt: now,
    updatedAt: now,
  });

  batch1.set(doc(db, 'applicationStatuses', 'SCH-2026-DEMO01'), {
    applicationNumber: 'SCH-2026-DEMO01',
    type: 'school',
    verificationEmailHash: demoEmailHash,
    schoolId: '',
    schoolName: 'Oakwood Science Magnet Academy',
    requestedRole: 'principal',
    status: 'submitted',
    schoolCode: '',
    applicantMessage: 'Your school application has been submitted and is awaiting Main Head review.',
    decisionNote: '',
    applicantResponseNote: '',
    submittedAt: new Date().toISOString(),
    createdAt: now,
    updatedAt: now,
  });

  try {
    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'demoSeed/batch1');
  }

  // Batch 2: School-Scoped Classes, Rooms, Subjects, Teachers, Students
  const batch2 = writeBatch(db);

  // Northridge Rooms
  const rooms = [
    { id: 'rm_nr_201', schoolId: 'school_northridge', roomNumber: '201', name: 'East Wing 201', building: 'East Wing', capacity: 36, roomType: 'classroom', available: true, status: 'active' },
    { id: 'rm_nr_202', schoolId: 'school_northridge', roomNumber: '202', name: 'East Wing 202', building: 'East Wing', capacity: 36, roomType: 'classroom', available: true, status: 'active' },
    { id: 'rm_nr_lab1', schoolId: 'school_northridge', roomNumber: 'B-104', name: 'Physics Lab B-104', building: 'Science Block', capacity: 30, roomType: 'science_lab', available: true, status: 'active' },
    { id: 'rm_nr_hall', schoolId: 'school_northridge', roomNumber: 'EH-01', name: 'Main Examination Hall', building: 'Central Hall', capacity: 120, roomType: 'exam_hall', available: true, status: 'active' },
    // Crestview Rooms
    { id: 'rm_cv_101', schoolId: 'school_crestview', roomNumber: '101', name: 'Harbor Room 101', building: 'North Pavilion', capacity: 32, roomType: 'classroom', available: true, status: 'active' },
    { id: 'rm_cv_bio', schoolId: 'school_crestview', roomNumber: 'L-201', name: 'Biology Laboratory', building: 'STEM Center', capacity: 28, roomType: 'science_lab', available: true, status: 'active' },
  ];
  for (const r of rooms) {
    batch2.set(doc(db, 'rooms', r.id), { ...r, createdBy: actorUid, createdAt: now, updatedAt: now });
  }

  // Classes
  const classes = [
    { id: 'cls_nr_10a', schoolId: 'school_northridge', name: 'Grade 10 - Section A', gradeLevel: '10', section: 'A', code: 'G10A', academicYear: '2026-2027', capacity: 32, classTeacherId: 'tch_nr_elena', classTeacherName: 'Prof. Elena Rostova', roomId: 'rm_nr_201', roomName: 'East Wing 201', status: 'active' },
    { id: 'cls_nr_10b', schoolId: 'school_northridge', name: 'Grade 10 - Section B', gradeLevel: '10', section: 'B', code: 'G10B', academicYear: '2026-2027', capacity: 32, classTeacherId: 'tch_nr_david', classTeacherName: 'Mr. David Okafor', roomId: 'rm_nr_202', roomName: 'East Wing 202', status: 'active' },
    { id: 'cls_nr_11a', schoolId: 'school_northridge', name: 'Grade 11 - Section A', gradeLevel: '11', section: 'A', code: 'G11A', academicYear: '2026-2027', capacity: 28, classTeacherId: 'tch_nr_sara', classTeacherName: 'Ms. Sara Al-Khatib', roomId: 'rm_nr_lab1', roomName: 'Physics Lab B-104', status: 'active' },
    { id: 'cls_cv_9a', schoolId: 'school_crestview', name: 'Grade 9 - Section A', gradeLevel: '9', section: 'A', code: 'CV9A', academicYear: '2026-2027', capacity: 28, classTeacherId: 'tch_cv_clara', classTeacherName: 'Ms. Clara Lindqvist', roomId: 'rm_cv_101', roomName: 'Harbor Room 101', status: 'active' },
    { id: 'cls_cv_10a', schoolId: 'school_crestview', name: 'Grade 10 - Section A', gradeLevel: '10', section: 'A', code: 'CV10A', academicYear: '2026-2027', capacity: 30, classTeacherId: 'tch_cv_samuel', classTeacherName: 'Mr. Samuel Boateng', roomId: 'rm_cv_bio', roomName: 'Biology Laboratory', status: 'active' },
  ];
  for (const c of classes) {
    batch2.set(doc(db, 'classes', c.id), { ...c, createdBy: actorUid, createdAt: now, updatedAt: now });
  }

  // Subjects
  const subjects = [
    { id: 'sub_nr_math_10a', schoolId: 'school_northridge', name: 'Mathematics', code: 'MATH-10', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', teacherId: 'tch_nr_elena', teacherName: 'Prof. Elena Rostova', status: 'active' },
    { id: 'sub_nr_phys_10a', schoolId: 'school_northridge', name: 'Physics', code: 'PHYS-10', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', teacherId: 'tch_nr_david', teacherName: 'Mr. David Okafor', status: 'active' },
    { id: 'sub_nr_lit_10a', schoolId: 'school_northridge', name: 'English Literature', code: 'ENG-10', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', teacherId: 'tch_nr_sara', teacherName: 'Ms. Sara Al-Khatib', status: 'active' },
    { id: 'sub_nr_math_10b', schoolId: 'school_northridge', name: 'Mathematics', code: 'MATH-10B', classId: 'cls_nr_10b', className: 'Grade 10 - Section B', teacherId: 'tch_nr_elena', teacherName: 'Prof. Elena Rostova', status: 'active' },
    { id: 'sub_cv_bio_9a', schoolId: 'school_crestview', name: 'Biology', code: 'BIO-09', classId: 'cls_cv_9a', className: 'Grade 9 - Section A', teacherId: 'tch_cv_clara', teacherName: 'Ms. Clara Lindqvist', status: 'active' },
    { id: 'sub_cv_hist_9a', schoolId: 'school_crestview', name: 'World History', code: 'HIST-09', classId: 'cls_cv_9a', className: 'Grade 9 - Section A', teacherId: 'tch_cv_samuel', teacherName: 'Mr. Samuel Boateng', status: 'active' },
  ];
  for (const s of subjects) {
    batch2.set(doc(db, 'subjects', s.id), { ...s, createdBy: actorUid, createdAt: now, updatedAt: now });
  }

  // Teachers
  const teachers = [
    { id: 'tch_nr_elena', schoolId: 'school_northridge', userId: 'demo_teacher_nr', staffId: 'NRP-T01', name: 'Prof. Elena Rostova', email: 'teacher.northridge@academiaone.edu', phone: '+1 (503) 555-0211', subjects: ['Mathematics', 'Statistics'], qualifications: 'M.Sc. Applied Mathematics', joiningDate: '2022-08-15', assignedClassIds: ['cls_nr_10a', 'cls_nr_10b'], classTeacherOfClassId: 'cls_nr_10a', status: 'active' },
    { id: 'tch_nr_david', schoolId: 'school_northridge', userId: 'demo_teacher_nr_2', staffId: 'NRP-T02', name: 'Mr. David Okafor', email: 'd.okafor@northridge.edu', phone: '+1 (503) 555-0212', subjects: ['Physics'], qualifications: 'M.Ed. Physics', joiningDate: '2023-08-20', assignedClassIds: ['cls_nr_10a', 'cls_nr_10b'], classTeacherOfClassId: 'cls_nr_10b', status: 'active' },
    { id: 'tch_nr_sara', schoolId: 'school_northridge', userId: 'demo_teacher_nr_3', staffId: 'NRP-T03', name: 'Ms. Sara Al-Khatib', email: 's.alkhatib@northridge.edu', phone: '+1 (503) 555-0213', subjects: ['English Literature'], qualifications: 'M.A. Comparative Literature', joiningDate: '2021-09-01', assignedClassIds: ['cls_nr_10a', 'cls_nr_11a'], classTeacherOfClassId: 'cls_nr_11a', status: 'active' },
    { id: 'tch_cv_clara', schoolId: 'school_crestview', userId: 'demo_teacher_cv', staffId: 'CVI-T01', name: 'Ms. Clara Lindqvist', email: 'teacher.crestview@academiaone.edu', phone: '+1 (425) 555-0311', subjects: ['Biology'], qualifications: 'M.Sc. Molecular Biology', joiningDate: '2024-01-10', assignedClassIds: ['cls_cv_9a'], classTeacherOfClassId: 'cls_cv_9a', status: 'active' },
    { id: 'tch_cv_samuel', schoolId: 'school_crestview', userId: 'demo_teacher_cv_2', staffId: 'CVI-T02', name: 'Mr. Samuel Boateng', email: 's.boateng@crestview.edu', phone: '+1 (425) 555-0312', subjects: ['World History'], qualifications: 'M.A. Modern History', joiningDate: '2023-08-18', assignedClassIds: ['cls_cv_9a', 'cls_cv_10a'], classTeacherOfClassId: 'cls_cv_10a', status: 'active' },
  ];
  for (const t of teachers) {
    batch2.set(doc(db, 'teachers', t.id), { ...t, createdBy: actorUid, createdAt: now, updatedAt: now });
  }

  // Students
  const students = [
    { id: 'stu_nr_01', schoolId: 'school_northridge', userId: 'demo_student_nr', admissionNumber: 'NRP-2026-001', rollNumber: '01', name: 'Aarav Mehta', email: 'student.northridge@academiaone.edu', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Vikram Mehta', guardianPhone: '+1 (503) 555-0401', guardianEmail: 'v.mehta@example.com', status: 'active', history: [{ date: '2026-09-01', event: 'Promoted to Grade 10-A', academicYear: '2026-2027' }] },
    { id: 'stu_nr_02', schoolId: 'school_northridge', userId: 'demo_student_nr_2', admissionNumber: 'NRP-2026-002', rollNumber: '02', name: 'Sophia Bennett', email: 's.bennett@northridge.edu', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Claire Bennett', guardianPhone: '+1 (503) 555-0402', guardianEmail: 'c.bennett@example.com', status: 'active', history: [{ date: '2026-09-01', event: 'Enrolled in Grade 10-A', academicYear: '2026-2027' }] },
    { id: 'stu_nr_03', schoolId: 'school_northridge', userId: 'demo_student_nr_3', admissionNumber: 'NRP-2026-003', rollNumber: '03', name: 'Liam Alvarez', email: 'l.alvarez@northridge.edu', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Carlos Alvarez', guardianPhone: '+1 (503) 555-0403', guardianEmail: 'c.alvarez@example.com', status: 'active', history: [{ date: '2026-09-01', event: 'Enrolled in Grade 10-A', academicYear: '2026-2027' }] },
    { id: 'stu_nr_04', schoolId: 'school_northridge', userId: 'demo_student_nr_4', admissionNumber: 'NRP-2026-004', rollNumber: '04', name: 'Chloe Park', email: 'c.park@northridge.edu', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Min-Jun Park', guardianPhone: '+1 (503) 555-0404', guardianEmail: 'm.park@example.com', status: 'active', history: [{ date: '2026-09-01', event: 'Enrolled in Grade 10-A', academicYear: '2026-2027' }] },
    { id: 'stu_nr_05', schoolId: 'school_northridge', userId: 'demo_student_nr_5', admissionNumber: 'NRP-2026-005', rollNumber: '01', name: 'Ethan Brooks', email: 'e.brooks@northridge.edu', classId: 'cls_nr_10b', className: 'Grade 10 - Section B', section: 'B', academicYear: '2026-2027', guardianName: 'Hannah Brooks', guardianPhone: '+1 (503) 555-0405', guardianEmail: 'h.brooks@example.com', status: 'active', history: [{ date: '2026-09-01', event: 'Enrolled in Grade 10-B', academicYear: '2026-2027' }] },
    { id: 'stu_nr_06', schoolId: 'school_northridge', userId: 'demo_student_nr_6', admissionNumber: 'NRP-2026-006', rollNumber: '02', name: 'Priya Nair', email: 'p.nair@northridge.edu', classId: 'cls_nr_11a', className: 'Grade 11 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Anil Nair', guardianPhone: '+1 (503) 555-0406', guardianEmail: 'a.nair@example.com', status: 'active', history: [{ date: '2026-09-01', event: 'Promoted to Grade 11-A', academicYear: '2026-2027' }] },
    // Crestview Students (Isolated tenant)
    { id: 'stu_cv_01', schoolId: 'school_crestview', userId: 'demo_student_cv', admissionNumber: 'CVI-2026-001', rollNumber: '01', name: 'Zara Al-Mansoor', email: 'student.crestview@academiaone.edu', classId: 'cls_cv_9a', className: 'Grade 9 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Tariq Al-Mansoor', guardianPhone: '+1 (425) 555-0501', guardianEmail: 't.mansoor@example.com', status: 'active', history: [{ date: '2026-09-05', event: 'Enrolled in Grade 9-A', academicYear: '2026-2027' }] },
    { id: 'stu_cv_02', schoolId: 'school_crestview', userId: 'demo_student_cv_2', admissionNumber: 'CVI-2026-002', rollNumber: '02', name: 'Lucas Meyer', email: 'l.meyer@crestview.edu', classId: 'cls_cv_9a', className: 'Grade 9 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Stefan Meyer', guardianPhone: '+1 (425) 555-0502', guardianEmail: 's.meyer@example.com', status: 'active', history: [{ date: '2026-09-05', event: 'Enrolled in Grade 9-A', academicYear: '2026-2027' }] },
    { id: 'stu_cv_03', schoolId: 'school_crestview', userId: 'demo_student_cv_3', admissionNumber: 'CVI-2026-003', rollNumber: '03', name: 'Amara Osei', email: 'a.osei@crestview.edu', classId: 'cls_cv_9a', className: 'Grade 9 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Kwame Osei', guardianPhone: '+1 (425) 555-0503', guardianEmail: 'k.osei@example.com', status: 'active', history: [{ date: '2026-09-05', event: 'Enrolled in Grade 9-A', academicYear: '2026-2027' }] },
    { id: 'stu_cv_04', schoolId: 'school_crestview', userId: 'demo_student_cv_4', admissionNumber: 'CVI-2026-004', rollNumber: '01', name: 'Oliver Grant', email: 'o.grant@crestview.edu', classId: 'cls_cv_10a', className: 'Grade 10 - Section A', section: 'A', academicYear: '2026-2027', guardianName: 'Rachel Grant', guardianPhone: '+1 (425) 555-0504', guardianEmail: 'r.grant@example.com', status: 'active', history: [{ date: '2026-09-05', event: 'Enrolled in Grade 10-A', academicYear: '2026-2027' }] },
  ];
  for (const st of students) {
    batch2.set(doc(db, 'students', st.id), { ...st, createdBy: actorUid, createdAt: now, updatedAt: now });
  }

  try {
    await batch2.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'demoSeed/batch2');
  }

  // Batch 3: Timetables, Attendance, Homework, Submissions, Exams, Results, Materials, Announcements, Notifications, Audit Logs
  const batch3 = writeBatch(db);

  const periods = [
    { id: 'tt_nr_mon_1', schoolId: 'school_northridge', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', dayOfWeek: 'Monday', periodNumber: 1, startTime: '08:30', endTime: '09:20', isBreak: false, subjectId: 'sub_nr_math_10a', subjectName: 'Mathematics', teacherId: 'tch_nr_elena', teacherName: 'Prof. Elena Rostova', roomId: 'rm_nr_201', roomName: 'East Wing 201', status: 'published' },
    { id: 'tt_nr_mon_2', schoolId: 'school_northridge', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', dayOfWeek: 'Monday', periodNumber: 2, startTime: '09:25', endTime: '10:15', isBreak: false, subjectId: 'sub_nr_phys_10a', subjectName: 'Physics', teacherId: 'tch_nr_david', teacherName: 'Mr. David Okafor', roomId: 'rm_nr_lab1', roomName: 'Physics Lab B-104', status: 'published' },
    { id: 'tt_nr_mon_3', schoolId: 'school_northridge', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', dayOfWeek: 'Monday', periodNumber: 3, startTime: '10:15', endTime: '10:35', isBreak: true, subjectName: 'Morning Break', status: 'published' },
    { id: 'tt_nr_mon_4', schoolId: 'school_northridge', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', dayOfWeek: 'Monday', periodNumber: 4, startTime: '10:35', endTime: '11:25', isBreak: false, subjectId: 'sub_nr_lit_10a', subjectName: 'English Literature', teacherId: 'tch_nr_sara', teacherName: 'Ms. Sara Al-Khatib', roomId: 'rm_nr_201', roomName: 'East Wing 201', status: 'published' },
    { id: 'tt_nr_wed_1', schoolId: 'school_northridge', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', dayOfWeek: 'Wednesday', periodNumber: 1, startTime: '08:30', endTime: '09:20', isBreak: false, subjectId: 'sub_nr_math_10a', subjectName: 'Mathematics', teacherId: 'tch_nr_elena', teacherName: 'Prof. Elena Rostova', roomId: 'rm_nr_201', roomName: 'East Wing 201', status: 'published' },
    { id: 'tt_nr_wed_2', schoolId: 'school_northridge', classId: 'cls_nr_10a', className: 'Grade 10 - Section A', dayOfWeek: 'Wednesday', periodNumber: 2, startTime: '09:25', endTime: '10:15', isBreak: false, subjectId: 'sub_nr_phys_10a', subjectName: 'Physics', teacherId: 'tch_nr_david', teacherName: 'Mr. David Okafor', roomId: 'rm_nr_lab1', roomName: 'Physics Lab B-104', status: 'published' },
    { id: 'tt_nr_wed_3', schoolId: 'school_northridge', classId: 'cls_nr_10b', className: 'Grade 10 - Section B', dayOfWeek: 'Wednesday', periodNumber: 2, startTime: '09:25', endTime: '10:15', isBreak: false, subjectId: 'sub_nr_math_10b', subjectName: 'Mathematics', teacherId: 'tch_nr_elena', teacherName: 'Prof. Elena Rostova', roomId: 'rm_nr_202', roomName: 'East Wing 202', status: 'published' },
    // Crestview Timetable
    { id: 'tt_cv_wed_1', schoolId: 'school_crestview', classId: 'cls_cv_9a', className: 'Grade 9 - Section A', dayOfWeek: 'Wednesday', periodNumber: 1, startTime: '08:45', endTime: '09:35', isBreak: false, subjectId: 'sub_cv_bio_9a', subjectName: 'Biology', teacherId: 'tch_cv_clara', teacherName: 'Ms. Clara Lindqvist', roomId: 'rm_cv_bio', roomName: 'Biology Laboratory', status: 'published' },
    { id: 'tt_cv_wed_2', schoolId: 'school_crestview', classId: 'cls_cv_9a', className: 'Grade 9 - Section A', dayOfWeek: 'Wednesday', periodNumber: 2, startTime: '09:40', endTime: '10:30', isBreak: false, subjectId: 'sub_cv_hist_9a', subjectName: 'World History', teacherId: 'tch_cv_samuel', teacherName: 'Mr. Samuel Boateng', roomId: 'rm_cv_101', roomName: 'Harbor Room 101', status: 'published' },
  ];
  for (const p of periods) {
    batch3.set(doc(db, 'timetablePeriods', p.id), { ...p, createdBy: actorUid, createdAt: now, updatedAt: now });
  }

  // Attendance Records
  batch3.set(doc(db, 'attendanceRecords', 'att_nr_10a_2026_11_18'), {
    id: 'att_nr_10a_2026_11_18',
    schoolId: 'school_northridge',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    date: '2026-11-18',
    teacherId: 'tch_nr_elena',
    status: 'submitted',
    entries: [
      { studentId: 'stu_nr_01', studentName: 'Aarav Mehta', rollNumber: '01', status: 'present' },
      { studentId: 'stu_nr_02', studentName: 'Sophia Bennett', rollNumber: '02', status: 'present' },
      { studentId: 'stu_nr_03', studentName: 'Liam Alvarez', rollNumber: '03', status: 'late', note: 'Bus delay (10 min)' },
      { studentId: 'stu_nr_04', studentName: 'Chloe Park', rollNumber: '04', status: 'absent', note: 'Medical leave' },
    ],
    editHistory: [{ editedBy: 'Prof. Elena Rostova', editedAt: '2026-11-18 08:42', note: 'Initial roll call submitted' }],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'attendanceRecords', 'att_nr_10a_2026_11_17'), {
    id: 'att_nr_10a_2026_11_17',
    schoolId: 'school_northridge',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    date: '2026-11-17',
    teacherId: 'tch_nr_elena',
    status: 'submitted',
    entries: [
      { studentId: 'stu_nr_01', studentName: 'Aarav Mehta', rollNumber: '01', status: 'present' },
      { studentId: 'stu_nr_02', studentName: 'Sophia Bennett', rollNumber: '02', status: 'present' },
      { studentId: 'stu_nr_03', studentName: 'Liam Alvarez', rollNumber: '03', status: 'present' },
      { studentId: 'stu_nr_04', studentName: 'Chloe Park', rollNumber: '04', status: 'present' },
    ],
    editHistory: [{ editedBy: 'Prof. Elena Rostova', editedAt: '2026-11-17 08:38', note: 'Full attendance' }],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'attendanceRecords', 'att_cv_9a_2026_11_18'), {
    id: 'att_cv_9a_2026_11_18',
    schoolId: 'school_crestview',
    classId: 'cls_cv_9a',
    className: 'Grade 9 - Section A',
    date: '2026-11-18',
    teacherId: 'tch_cv_clara',
    status: 'submitted',
    entries: [
      { studentId: 'stu_cv_01', studentName: 'Zara Al-Mansoor', rollNumber: '01', status: 'present' },
      { studentId: 'stu_cv_02', studentName: 'Lucas Meyer', rollNumber: '02', status: 'present' },
      { studentId: 'stu_cv_03', studentName: 'Amara Osei', rollNumber: '03', status: 'present' },
    ],
    editHistory: [{ editedBy: 'Ms. Clara Lindqvist', editedAt: '2026-11-18 08:52', note: 'Submitted' }],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  // Homework & Submissions
  batch3.set(doc(db, 'homework', 'hw_nr_quadratics'), {
    id: 'hw_nr_quadratics',
    schoolId: 'school_northridge',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    subjectId: 'sub_nr_math_10a',
    subjectName: 'Mathematics',
    teacherId: 'tch_nr_elena',
    teacherName: 'Prof. Elena Rostova',
    title: 'Quadratic Optimization Problem Set',
    instructions: 'Solve exercises 1–10 on vertex optimization and upload your worked PDF or summary notes before Friday 5:00 PM.',
    assignedDate: '2026-11-16',
    dueDate: '2026-11-22',
    allowOnlineSubmission: true,
    attachmentName: 'Ch4_Quadratic_Optimization.pdf',
    status: 'published',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'homework', 'hw_nr_optics'), {
    id: 'hw_nr_optics',
    schoolId: 'school_northridge',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    subjectId: 'sub_nr_phys_10a',
    subjectName: 'Physics',
    teacherId: 'tch_nr_david',
    teacherName: 'Mr. David Okafor',
    title: 'Refraction Lab Observation Report',
    instructions: 'Document Snell’s Law angle measurements from Lab B-104 and include error analysis.',
    assignedDate: '2026-11-15',
    dueDate: '2026-11-25',
    allowOnlineSubmission: true,
    attachmentName: 'Optics_Lab_Worksheet.docx',
    status: 'published',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'homework', 'hw_cv_mitosis'), {
    id: 'hw_cv_mitosis',
    schoolId: 'school_crestview',
    classId: 'cls_cv_9a',
    className: 'Grade 9 - Section A',
    subjectId: 'sub_cv_bio_9a',
    subjectName: 'Biology',
    teacherId: 'tch_cv_clara',
    teacherName: 'Ms. Clara Lindqvist',
    title: 'Cell Division & Mitosis Diagram',
    instructions: 'Label all four mitotic stages with microscope observations from today’s slide preparation.',
    assignedDate: '2026-11-17',
    dueDate: '2026-11-24',
    allowOnlineSubmission: true,
    attachmentName: 'Mitosis_Guide.pdf',
    status: 'published',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'homeworkSubmissions', 'hws_nr_01'), {
    id: 'hws_nr_01',
    schoolId: 'school_northridge',
    homeworkId: 'hw_nr_quadratics',
    classId: 'cls_nr_10a',
    studentId: 'stu_nr_01',
    studentUid: 'demo_student_nr',
    studentName: 'Aarav Mehta',
    fileName: 'Aarav_Quadratics_Set4.pdf',
    fileType: 'PDF',
    fileSizeKb: 412,
    submissionText: 'Completed problems 1-10 including step-by-step completing-the-square verification.',
    submittedAt: '2026-11-18 09:15',
    isLate: false,
    reviewStatus: 'completed',
    feedback: 'Clear vertex derivations on Question 8 and 9. Excellent work.',
    createdAt: now,
    updatedAt: now,
  });

  // Examinations & Results
  batch3.set(doc(db, 'examinations', 'ex_nr_mid_math'), {
    id: 'ex_nr_mid_math',
    schoolId: 'school_northridge',
    name: 'Autumn Midterm Examination',
    category: 'midterm',
    academicYear: '2026-2027',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    subjectId: 'sub_nr_math_10a',
    subjectName: 'Mathematics',
    date: '2026-11-28',
    startTime: '09:00',
    endTime: '11:00',
    maxMarks: 100,
    passingMarks: 40,
    roomId: 'rm_nr_hall',
    roomName: 'Main Examination Hall',
    schedulePublished: true,
    resultsPublished: true,
    status: 'scheduled',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'examinations', 'ex_nr_unit_phys'), {
    id: 'ex_nr_unit_phys',
    schoolId: 'school_northridge',
    name: 'Unit Test II — Mechanics & Optics',
    category: 'unit_test',
    academicYear: '2026-2027',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    subjectId: 'sub_nr_phys_10a',
    subjectName: 'Physics',
    date: '2026-12-03',
    startTime: '09:00',
    endTime: '10:30',
    maxMarks: 50,
    passingMarks: 20,
    roomId: 'rm_nr_201',
    roomName: 'East Wing 201',
    schedulePublished: true,
    resultsPublished: true,
    status: 'completed',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'examinations', 'ex_cv_mid_bio'), {
    id: 'ex_cv_mid_bio',
    schoolId: 'school_crestview',
    name: 'Term I Biology Assessment',
    category: 'midterm',
    academicYear: '2026-2027',
    classId: 'cls_cv_9a',
    className: 'Grade 9 - Section A',
    subjectId: 'sub_cv_bio_9a',
    subjectName: 'Biology',
    date: '2026-11-30',
    startTime: '10:00',
    endTime: '11:30',
    maxMarks: 100,
    passingMarks: 40,
    roomId: 'rm_cv_bio',
    roomName: 'Biology Laboratory',
    schedulePublished: true,
    resultsPublished: true,
    status: 'completed',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'examResults', 'res_nr_01'), {
    id: 'res_nr_01',
    schoolId: 'school_northridge',
    examId: 'ex_nr_mid_math',
    examName: 'Autumn Midterm Examination',
    classId: 'cls_nr_10a',
    subjectName: 'Mathematics',
    studentId: 'stu_nr_01',
    studentUid: 'demo_student_nr',
    studentName: 'Aarav Mehta',
    maxMarks: 100,
    passingMarks: 40,
    obtainedMarks: 94,
    grade: 'A+',
    remarks: 'Strong analytical reasoning across algebra and geometry.',
    status: 'published',
    auditHistory: [{ updatedBy: 'Prof. Elena Rostova', updatedAt: '2026-11-16', previousMarks: 0, newMarks: 94 }],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'examResults', 'res_nr_02'), {
    id: 'res_nr_02',
    schoolId: 'school_northridge',
    examId: 'ex_nr_unit_phys',
    examName: 'Unit Test II — Mechanics & Optics',
    classId: 'cls_nr_10a',
    subjectName: 'Physics',
    studentId: 'stu_nr_01',
    studentUid: 'demo_student_nr',
    studentName: 'Aarav Mehta',
    maxMarks: 50,
    passingMarks: 20,
    obtainedMarks: 45,
    grade: 'A',
    remarks: 'Consistent lab calculations.',
    status: 'published',
    auditHistory: [{ updatedBy: 'Mr. David Okafor', updatedAt: '2026-11-17', previousMarks: 0, newMarks: 45 }],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'examResults', 'res_nr_03'), {
    id: 'res_nr_03',
    schoolId: 'school_northridge',
    examId: 'ex_nr_mid_math',
    examName: 'Autumn Midterm Examination',
    classId: 'cls_nr_10a',
    subjectName: 'Mathematics',
    studentId: 'stu_nr_02',
    studentUid: 'demo_student_nr_2',
    studentName: 'Sophia Bennett',
    maxMarks: 100,
    passingMarks: 40,
    obtainedMarks: 88,
    grade: 'A',
    remarks: 'Great progress on quadratic inequalities.',
    status: 'published',
    auditHistory: [{ updatedBy: 'Prof. Elena Rostova', updatedAt: '2026-11-16', previousMarks: 0, newMarks: 88 }],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'examResults', 'res_cv_01'), {
    id: 'res_cv_01',
    schoolId: 'school_crestview',
    examId: 'ex_cv_mid_bio',
    examName: 'Term I Biology Assessment',
    classId: 'cls_cv_9a',
    subjectName: 'Biology',
    studentId: 'stu_cv_01',
    studentUid: 'demo_student_cv',
    studentName: 'Zara Al-Mansoor',
    maxMarks: 100,
    passingMarks: 40,
    obtainedMarks: 91,
    grade: 'A',
    remarks: 'Thorough cellular respiration essay.',
    status: 'published',
    auditHistory: [{ updatedBy: 'Ms. Clara Lindqvist', updatedAt: '2026-11-17', previousMarks: 0, newMarks: 91 }],
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  // Learning Materials
  batch3.set(doc(db, 'learningMaterials', 'mat_nr_01'), {
    id: 'mat_nr_01',
    schoolId: 'school_northridge',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    subjectName: 'Mathematics',
    teacherId: 'tch_nr_elena',
    teacherName: 'Prof. Elena Rostova',
    title: 'Chapter 4: Quadratic Functions & Discriminant Notes',
    topic: 'Quadratic Algebra',
    description: 'Worked examples covering discriminant classification, vertex form, and real-world parabola modeling.',
    fileName: 'Quadratic_Functions_Summary.pdf',
    fileType: 'PDF',
    fileSizeKb: 640,
    contentPreview: 'Key Formula: x = (-b ± √(b² - 4ac)) / 2a. When Δ > 0, two distinct real roots exist; Δ = 0 yields one repeated root.',
    status: 'published',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'learningMaterials', 'mat_nr_02'), {
    id: 'mat_nr_02',
    schoolId: 'school_northridge',
    classId: 'cls_nr_10a',
    className: 'Grade 10 - Section A',
    subjectName: 'Physics',
    teacherId: 'tch_nr_david',
    teacherName: 'Mr. David Okafor',
    title: 'Ray Optics & Snell’s Law Slide Deck',
    topic: 'Optics & Waves',
    description: 'Reference diagrams for refraction across glass prisms and critical angle calculations.',
    fileName: 'Ray_Optics_Deck.pptx',
    fileType: 'SLIDES',
    fileSizeKb: 1280,
    contentPreview: 'Snell’s Law: n1 sin(θ1) = n2 sin(θ2). Total internal reflection occurs when θ1 exceeds the critical angle.',
    status: 'published',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'learningMaterials', 'mat_cv_01'), {
    id: 'mat_cv_01',
    schoolId: 'school_crestview',
    classId: 'cls_cv_9a',
    className: 'Grade 9 - Section A',
    subjectName: 'Biology',
    teacherId: 'tch_cv_clara',
    teacherName: 'Ms. Clara Lindqvist',
    title: 'Mitosis & Cell Cycle Reference Sheet',
    topic: 'Cellular Biology',
    description: 'Annotated high-contrast microscopy guide for Prophase, Metaphase, Anaphase, and Telophase.',
    fileName: 'Mitosis_Reference.pdf',
    fileType: 'PDF',
    fileSizeKb: 520,
    contentPreview: 'Interphase (G1, S, G2) prepares chromosomal DNA prior to mitotic spindle alignment in Metaphase.',
    status: 'published',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  });

  // Announcements
  batch3.set(doc(db, 'announcements', 'ann_nr_01'), {
    id: 'ann_nr_01',
    schoolId: 'school_northridge',
    title: 'Autumn Midterm Examination Timetable Published',
    body: 'The official Autumn Midterm timetable for Grades 10 and 11 is now live. Students should report to Main Examination Hall 15 minutes before the start time.',
    audience: 'school_wide',
    targetClassId: '',
    targetRole: '',
    attachmentName: 'Autumn_Midterm_Schedule_2026.pdf',
    authorId: 'demo_principal_nr',
    authorName: 'Dr. Eleanor Vance',
    authorRole: 'principal',
    status: 'published',
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'announcements', 'ann_nr_02'), {
    id: 'ann_nr_02',
    schoolId: 'school_northridge',
    title: 'Grade 10-A Physics Lab Safety Briefing',
    body: 'Bring lab notebooks and closed-toe shoes for Wednesday Period 2 optics bench sessions.',
    audience: 'class_specific',
    targetClassId: 'cls_nr_10a',
    targetRole: '',
    attachmentName: '',
    authorId: 'demo_teacher_nr',
    authorName: 'Prof. Elena Rostova',
    authorRole: 'teacher',
    status: 'published',
    createdAt: now,
    updatedAt: now,
  });

  batch3.set(doc(db, 'announcements', 'ann_cv_01'), {
    id: 'ann_cv_01',
    schoolId: 'school_crestview',
    title: 'STEM Fair Project Proposals Open',
    body: 'Crestview students in Grades 9 and 10 may submit project abstracts to their homeroom teacher before December 5.',
    audience: 'school_wide',
    targetClassId: '',
    targetRole: '',
    attachmentName: '',
    authorId: 'demo_principal_cv',
    authorName: 'Dr. Rajesh Kapoor',
    authorRole: 'principal',
    status: 'published',
    createdAt: now,
    updatedAt: now,
  });

  // Notifications for the active actor (Main Head)
  const demoNotifs = [
    {
      id: 'ntf_demo_1',
      userId: actorUid,
      schoolId: 'platform',
      category: 'messages',
      title: 'New School Registration Application',
      body: 'Oakwood Science Magnet Academy submitted application SCH-2026-DEMO01 for Main Head review.',
      linkRoute: '/main-head/applications',
      isRead: false,
    },
    {
      id: 'ntf_demo_2',
      userId: actorUid,
      schoolId: 'school_crestview',
      category: 'task_reminders',
      title: 'Trial Subscription Expiring Soon',
      body: 'Crestview International School trial ends on 2026-12-01. Follow up for annual conversion.',
      linkRoute: '/main-head/subscriptions',
      isRead: false,
    },
    {
      id: 'ntf_demo_3',
      userId: actorUid,
      schoolId: 'platform',
      category: 'special_offers',
      title: 'Annual Academic Billing Offer Active',
      body: '20% multi-campus discount template is ready to share with onboarding schools.',
      linkRoute: '/main-head/plans',
      isRead: false,
    },
  ];
  for (const n of demoNotifs) {
    batch3.set(doc(db, 'notifications', n.id), { ...n, createdAt: now });
  }

  // Audit Log
  batch3.set(doc(db, 'auditLogs', 'aud_demo_seed'), {
    id: 'aud_demo_seed',
    schoolId: 'platform',
    actorUid,
    actorName,
    actorRole: 'main_head',
    action: 'SEED_DEMO_ENVIRONMENT',
    targetType: 'platform',
    targetId: 'demo_schools',
    targetLabel: 'Northridge Preparatory Academy & Crestview International School',
    details: 'Initialized 2 isolated demo schools with classes, staff, students, timetables, homework, exams, and notifications.',
    createdAt: now,
  });

  try {
    await batch3.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'demoSeed/batch3');
  }
}

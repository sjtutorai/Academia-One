# AcademiaOne Firestore Security Specification

## 1. Data Invariants
1. **Strict Tenant Isolation (`schoolId`)**: Every school-scoped entity (`classes`, `subjects`, `rooms`, `teachers`, `students`, `timetablePeriods`, `attendanceRecords`, `homework`, `homeworkSubmissions`, `examinations`, `examResults`, `learningMaterials`, `announcements`, `schoolSubscriptions`) MUST carry a valid `schoolId`. A Principal, Coordinator, Teacher, or Student can never read or write documents whose `schoolId` differs from their own verified profile `schoolId`.
2. **Role Privilege Protection**: Self-registered users can only create a `users/{uid}` document with `role == 'student'` and `status == 'active'`. Only the bootstrapped Main Head (`sjtutorai@gmail.com` with `email_verified == true`) or a verified `main_head` can create/modify schools, subscription plans, platform settings, or `principal` accounts.
3. **Immutable Audit Trail**: `auditLogs` are append-only (`allow update, delete: if false;`).
4. **Marks & Academic Bounds**: `examResults.obtainedMarks` MUST satisfy `obtainedMarks >= 0 && obtainedMarks <= maxMarks`.
5. **PII Isolation**: User profiles, students, teachers, and school enquiries are never publicly readable. `notificationPreferences/{userId}` and `notifications` are strictly owner-scoped (`userId == request.auth.uid`).
6. **Temporal Integrity & Path Hardening**: Every single-document operation validates `isValidId(docId)`. Server timestamps (`request.time`) are enforced on create/update timestamps.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Privilege Escalation**: Regular user attempts to create `/users/{uid}` with `role: "main_head"`. -> MUST FAIL (`PERMISSION_DENIED`).
2. **Role Mutation Attack**: Teacher attempts to update their own `/users/{uid}` document to change `role: "principal"`. -> MUST FAIL.
3. **Cross-Tenant School Read**: Principal of `school_northridge` attempts `get` on `/students/stu_crestview_01` (`schoolId: "school_crestview"`). -> MUST FAIL.
4. **Cross-Tenant Write Spoofing**: Principal of `school_northridge` attempts to create a class with `schoolId: "school_crestview"`. -> MUST FAIL.
5. **Shadow Field Injection**: Principal attempts to update a school class while injecting an unexpected key `isVerifiedAdmin: true`. -> MUST FAIL (`hasOnly`).
6. **Email Spoofing (Unverified Admin)**: Attacker authenticates with `email: "sjtutorai@gmail.com"` and `email_verified: false` to mutate `/schools/school_northridge`. -> MUST FAIL.
7. **Student Attendance Tampering**: Student attempts to update `/attendanceRecords/att_01` to mark themselves `present`. -> MUST FAIL.
8. **Marks Overflow Attack**: Teacher attempts to write `obtainedMarks: 150` when `maxMarks: 100` in `/examResults/res_01`. -> MUST FAIL.
9. **Audit Log Erasure**: Principal attempts to delete `/auditLogs/log_01` to hide a marks edit. -> MUST FAIL.
10. **PII Blanket Scraping**: Student attempts to `get` another student's `/users/other_uid` or `/notificationPreferences/other_uid`. -> MUST FAIL.
11. **Resource Poisoning via Oversized ID**: User attempts to create `/announcements/{2000-char-id}` or write a 50KB title string. -> MUST FAIL (`isValidId` and `.size()`).
12. **Client Timestamp Forgery**: User attempts to create `/schoolEnquiries/enq_1` with a backdated `createdAt` instead of `request.time`. -> MUST FAIL.

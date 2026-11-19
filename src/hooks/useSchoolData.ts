import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type {
  SchoolClass,
  Subject,
  Room,
  TeacherProfile,
  StudentProfile,
  TimetablePeriod,
  AttendanceRecord,
  Homework,
  HomeworkSubmission,
  Examination,
  ExamResult,
  LearningMaterial,
  Announcement,
  PlatformUser,
} from '../types/models';

export interface SchoolDataBundle {
  classes: SchoolClass[];
  subjects: Subject[];
  rooms: Room[];
  teachers: TeacherProfile[];
  students: StudentProfile[];
  timetable: TimetablePeriod[];
  attendance: AttendanceRecord[];
  homework: Homework[];
  submissions: HomeworkSubmission[];
  examinations: Examination[];
  examResults: ExamResult[];
  materials: LearningMaterial[];
  announcements: Announcement[];
  schoolUsers: PlatformUser[];
  loading: boolean;
}

export function useSchoolData(
  schoolId: string | undefined,
  includeSchoolUsers = false,
  studentUidFilter?: string,
): SchoolDataBundle {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [timetable, setTimetable] = useState<TimetablePeriod[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [submissions, setSubmissions] = useState<HomeworkSubmission[]>([]);
  const [examinations, setExaminations] = useState<Examination[]>([]);
  const [examResults, setExamResults] = useState<ExamResult[]>([]);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [schoolUsers, setSchoolUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId || schoolId === 'platform' || schoolId === 'unassigned') {
      setLoading(false);
      return;
    }

    setLoading(true);
    let settled = 0;
    const total = includeSchoolUsers ? 14 : 13;
    const markSettled = () => {
      settled += 1;
      if (settled >= total) setLoading(false);
    };

    const subQuery = <T,>(
      colName: string,
      q: ReturnType<typeof query>,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
    ) =>
      onSnapshot(
        q,
        (snap) => {
          setter(snap.docs.map((d) => d.data() as T));
          markSettled();
        },
        (err) => {
          console.warn(`School listener (${colName}) warning:`, err.message);
          markSettled();
        },
      );

    const sub = <T,>(colName: string, setter: React.Dispatch<React.SetStateAction<T[]>>) =>
      subQuery<T>(colName, query(collection(db, colName), where('schoolId', '==', schoolId)), setter);

    const studentsQuery = studentUidFilter
      ? query(collection(db, 'students'), where('schoolId', '==', schoolId), where('userId', '==', studentUidFilter))
      : query(collection(db, 'students'), where('schoolId', '==', schoolId));

    const submissionsQuery = studentUidFilter
      ? query(
          collection(db, 'homeworkSubmissions'),
          where('schoolId', '==', schoolId),
          where('studentUid', '==', studentUidFilter),
        )
      : query(collection(db, 'homeworkSubmissions'), where('schoolId', '==', schoolId));

    const resultsQuery = studentUidFilter
      ? query(
          collection(db, 'examResults'),
          where('schoolId', '==', schoolId),
          where('studentUid', '==', studentUidFilter),
          where('status', '==', 'published'),
        )
      : query(collection(db, 'examResults'), where('schoolId', '==', schoolId));

    const unsubs = [
      sub<SchoolClass>('classes', setClasses),
      sub<Subject>('subjects', setSubjects),
      sub<Room>('rooms', setRooms),
      sub<TeacherProfile>('teachers', setTeachers),
      subQuery<StudentProfile>('students', studentsQuery, setStudents),
      sub<TimetablePeriod>('timetablePeriods', setTimetable),
      sub<AttendanceRecord>('attendanceRecords', setAttendance),
      sub<Homework>('homework', setHomework),
      subQuery<HomeworkSubmission>('homeworkSubmissions', submissionsQuery, setSubmissions),
      sub<Examination>('examinations', setExaminations),
      subQuery<ExamResult>('examResults', resultsQuery, setExamResults),
      sub<LearningMaterial>('learningMaterials', setMaterials),
      sub<Announcement>('announcements', setAnnouncements),
    ];

    if (includeSchoolUsers) {
      unsubs.push(sub<PlatformUser>('users', setSchoolUsers));
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [schoolId, includeSchoolUsers, studentUidFilter]);

  return {
    classes,
    subjects,
    rooms,
    teachers,
    students,
    timetable,
    attendance,
    homework,
    submissions,
    examinations,
    examResults,
    materials,
    announcements,
    schoolUsers,
    loading,
  };
}

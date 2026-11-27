import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sortClassesInOrder } from '../lib/schoolCodes';
import type {
  SchoolClass,
  Subject,
  Room,
  TeacherProfile,
  StudentProfile,
  TimetablePeriod,
  AttendanceRecord,
  TeacherAttendanceRecord,
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
  teacherAttendance: TeacherAttendanceRecord[];
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
  teacherUidFilter?: string,
): SchoolDataBundle {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [timetable, setTimetable] = useState<TimetablePeriod[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [teacherAttendance, setTeacherAttendance] = useState<TeacherAttendanceRecord[]>([]);
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
    const settledCols = new Set<string>();
    const includeTeacherAttendance = !studentUidFilter;
    const total = 13 + (includeSchoolUsers ? 1 : 0) + (includeTeacherAttendance ? 1 : 0);
    const fallbackTimer = window.setTimeout(() => {
      setLoading(false);
    }, 6000);
    const markSettled = (colName: string) => {
      settledCols.add(colName);
      if (settledCols.size >= total) {
        window.clearTimeout(fallbackTimer);
        setLoading(false);
      }
    };

    const subQuery = <T,>(
      colName: string,
      q: ReturnType<typeof query>,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      transform?: (items: T[]) => T[],
    ) =>
      onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.map((d) => d.data() as T);
          setter(transform ? transform(items) : items);
          markSettled(colName);
        },
        (err) => {
          console.warn(`School listener (${colName}) warning:`, err.message);
          markSettled(colName);
        },
      );

    const sub = <T,>(
      colName: string,
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      transform?: (items: T[]) => T[],
    ) => subQuery<T>(colName, query(collection(db, colName), where('schoolId', '==', schoolId)), setter, transform);

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
      sub<SchoolClass>('classes', setClasses, sortClassesInOrder),
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

    if (includeTeacherAttendance) {
      const teacherAttendanceQuery = teacherUidFilter
        ? query(
            collection(db, 'teacherAttendance'),
            where('schoolId', '==', schoolId),
            where('teacherUid', '==', teacherUidFilter),
          )
        : query(collection(db, 'teacherAttendance'), where('schoolId', '==', schoolId));
      unsubs.push(subQuery<TeacherAttendanceRecord>('teacherAttendance', teacherAttendanceQuery, setTeacherAttendance));
    }

    if (includeSchoolUsers) {
      unsubs.push(sub<PlatformUser>('users', setSchoolUsers));
    }

    return () => {
      window.clearTimeout(fallbackTimer);
      unsubs.forEach((u) => u());
    };
  }, [schoolId, includeSchoolUsers, studentUidFilter, teacherUidFilter]);

  return {
    classes,
    subjects,
    rooms,
    teachers,
    students,
    timetable,
    attendance,
    teacherAttendance,
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

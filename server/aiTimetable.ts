import { GoogleGenAI, Type } from '@google/genai';

export interface AiTimetableSlotInput {
  periodNumber: number;
  label: string;
  startTime: string;
  endTime: string;
  isBreak?: boolean;
}

export interface AiTimetableClassInput {
  id: string;
  name: string;
  code: string;
  classTeacherId?: string;
  roomId?: string;
  roomName?: string;
}

export interface AiTimetableSubjectInput {
  id: string;
  name: string;
  code: string;
  classId: string;
  className?: string;
  teacherId?: string;
  teacherName?: string;
}

export interface AiTimetableTeacherInput {
  id: string;
  name: string;
  staffId?: string;
  subjects?: string[];
  assignedClassIds?: string[];
  status?: string;
}

export interface AiTimetableRoomInput {
  id: string;
  name: string;
  roomNumber?: string;
  roomType?: string;
  capacity?: number;
}

export interface AiTimetableBusySlotInput {
  classId: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherId?: string;
  roomId?: string;
}

export interface AiTimetableRequestPayload {
  schoolName?: string;
  workingDays: string[];
  periodSchedule: AiTimetableSlotInput[];
  targetClasses: AiTimetableClassInput[];
  subjects: AiTimetableSubjectInput[];
  teachers: AiTimetableTeacherInput[];
  rooms: AiTimetableRoomInput[];
  existingOtherClassPeriods?: AiTimetableBusySlotInput[];
  customInstructions?: string;
}

export interface AiGeneratedPeriodItem {
  classId: string;
  className: string;
  dayOfWeek: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  isBreak: false;
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  roomId: string;
  roomName: string;
}

export interface AiTimetableGenerationResult {
  summary: string;
  periods: AiGeneratedPeriodItem[];
}

export class AiTimetableHttpError extends Error {
  statusCode: number;
  errorStatus: string;

  constructor(statusCode: number, errorStatus: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorStatus = errorStatus;
  }
}

const VALID_DAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 < e2 && s2 < e1;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();
  if (!apiKey) {
    throw new AiTimetableHttpError(
      503,
      'API_KEY_MISSING',
      'Gemini API key is not configured on the server. Add GEMINI_API_KEY in AI Studio Settings > Secrets (or your hosting Environment Variables).',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /500|502|503|504|UNAVAILABLE|INTERNAL|timeout|network/i.test(msg);
      if (!isTransient || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw lastError;
}

export async function generateAiTimetable(
  payload: AiTimetableRequestPayload,
): Promise<AiTimetableGenerationResult> {
  const workingDays = Array.isArray(payload.workingDays)
    ? payload.workingDays.filter((d) => typeof d === 'string' && VALID_DAYS.has(d))
    : [];
  const targetClasses = Array.isArray(payload.targetClasses) ? payload.targetClasses.slice(0, 25) : [];
  const allSubjects = Array.isArray(payload.subjects) ? payload.subjects.slice(0, 200) : [];
  const allTeachers = Array.isArray(payload.teachers)
    ? payload.teachers.filter((t) => t && t.id && t.name && t.status !== 'inactive').slice(0, 150)
    : [];
  const allRooms = Array.isArray(payload.rooms) ? payload.rooms.slice(0, 100) : [];
  const rawSchedule = Array.isArray(payload.periodSchedule) ? payload.periodSchedule : [];
  const teachingSlots = rawSchedule
    .filter((s) => s && !s.isBreak && Number(s.periodNumber) >= 1 && Number(s.periodNumber) <= 12)
    .sort((a, b) => a.periodNumber - b.periodNumber);
  const busyOtherSlots = Array.isArray(payload.existingOtherClassPeriods)
    ? payload.existingOtherClassPeriods.slice(0, 400)
    : [];

  if (workingDays.length === 0) {
    throw new AiTimetableHttpError(400, 'INVALID_ARGUMENT', 'At least one working day is required.');
  }
  if (targetClasses.length === 0) {
    throw new AiTimetableHttpError(400, 'INVALID_ARGUMENT', 'Select at least one class to generate a timetable.');
  }
  if (teachingSlots.length === 0) {
    throw new AiTimetableHttpError(
      400,
      'INVALID_ARGUMENT',
      'No teaching period slots are configured in School Settings.',
    );
  }
  if (allSubjects.length === 0 && allTeachers.length === 0) {
    throw new AiTimetableHttpError(
      400,
      'INVALID_ARGUMENT',
      'Add teachers and subjects to your school before generating an AI timetable.',
    );
  }

  const ai = getGeminiClient();

  const classMap = new Map(targetClasses.map((c) => [c.id, c]));
  const subjectMap = new Map(allSubjects.map((s) => [s.id, s]));
  const teacherMap = new Map(allTeachers.map((t) => [t.id, t]));
  const roomMap = new Map(allRooms.map((r) => [r.id, r]));
  const slotByPeriodNumber = new Map(teachingSlots.map((s) => [s.periodNumber, s]));

  const customInstructions = typeof payload.customInstructions === 'string'
    ? payload.customInstructions.trim().slice(0, 500)
    : '';

  const systemInstruction = [
    'You are an expert school academic timetable scheduler for SJ Academia One.',
    'Generate a clean, balanced, conflict-free weekly timetable using ONLY the provided classes, subjects, teachers, rooms, working days, and teaching period numbers.',
    'Hard scheduling rules:',
    '1. Never schedule breaks or periodNumber 0 — ONLY schedule the provided teaching period numbers (1..N). Breaks are added separately.',
    '2. Never assign the same teacher to two different classes on the same dayOfWeek and periodNumber (or overlapping with busyOtherClassPeriods).',
    '3. Never assign the same room to two different classes on the same dayOfWeek and periodNumber (or overlapping with busyOtherClassPeriods).',
    '4. For each class, strongly prefer subjects whose classId matches that class and the teacherId already assigned to that subject. If a class has no assigned subjects, pick appropriate subjects from the provided subjects list and match with teachers whose subjects include that subject.',
    '5. Distribute subjects evenly across the week, avoid scheduling the same subject in consecutive periods when possible, and balance daily teacher workload.',
    '6. Always return exact IDs from the input JSON (or empty string "" if no matching room/subject/teacher ID exists). Never invent fake IDs.',
    '7. Fill every working day and every teaching periodNumber for each target class.',
  ].join('\n');

  const promptData = {
    schoolName: (payload.schoolName || 'School').slice(0, 120),
    workingDays,
    teachingPeriods: teachingSlots.map((s) => ({
      periodNumber: s.periodNumber,
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    targetClasses: targetClasses.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      classTeacherId: c.classTeacherId || '',
      defaultRoomId: c.roomId || '',
      defaultRoomName: c.roomName || '',
    })),
    subjects: allSubjects.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      classId: s.classId,
      teacherId: s.teacherId || '',
      teacherName: s.teacherName || '',
    })),
    teachers: allTeachers.map((t) => ({
      id: t.id,
      name: t.name,
      subjects: Array.isArray(t.subjects) ? t.subjects : [],
      assignedClassIds: Array.isArray(t.assignedClassIds) ? t.assignedClassIds : [],
    })),
    rooms: allRooms.map((r) => ({
      id: r.id,
      name: r.name,
      roomType: r.roomType || 'classroom',
    })),
    busyOtherClassPeriods: busyOtherSlots.map((b) => ({
      dayOfWeek: b.dayOfWeek,
      startTime: b.startTime,
      endTime: b.endTime,
      teacherId: b.teacherId || '',
      roomId: b.roomId || '',
    })),
    principalPreferences: customInstructions || 'Balanced distribution of subjects across morning and afternoon periods.',
  };

  let rawText = '';
  try {
    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Generate the weekly timetable JSON for this school data:\n${JSON.stringify(promptData)}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: 'Brief 1-2 sentence explanation of how subjects and teachers were balanced.',
              },
              assignments: {
                type: Type.ARRAY,
                description: 'List of scheduled teaching periods.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    classId: { type: Type.STRING },
                    dayOfWeek: { type: Type.STRING },
                    periodNumber: { type: Type.INTEGER },
                    subjectId: { type: Type.STRING },
                    subjectName: { type: Type.STRING },
                    teacherId: { type: Type.STRING },
                    teacherName: { type: Type.STRING },
                    roomId: { type: Type.STRING },
                    roomName: { type: Type.STRING },
                  },
                  required: ['classId', 'dayOfWeek', 'periodNumber', 'subjectName'],
                },
              },
            },
            required: ['summary', 'assignments'],
          },
        },
      }),
    );
    rawText = (response.text ?? '').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/API_KEY_INVALID|PERMISSION_DENIED|403|401|API key/i.test(msg)) {
      throw new AiTimetableHttpError(
        403,
        'PERMISSION_DENIED',
        'Gemini API key was rejected. Please verify your API key in Settings > Secrets.',
      );
    }
    if (/RESOURCE_EXHAUSTED|429|quota/i.test(msg)) {
      throw new AiTimetableHttpError(
        429,
        'RESOURCE_EXHAUSTED',
        'Gemini API quota limit reached. Please wait a moment or check your billing/quota in Settings > Secrets.',
      );
    }
    if (/NOT_FOUND|404/i.test(msg)) {
      throw new AiTimetableHttpError(
        502,
        'MODEL_NOT_FOUND',
        'Configured AI model is temporarily unavailable. Please try again shortly.',
      );
    }
    throw new AiTimetableHttpError(
      502,
      'UPSTREAM_ERROR',
      msg || 'Unable to generate timetable with AI right now. Please try again.',
    );
  }

  let parsed: { summary?: string; assignments?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new AiTimetableHttpError(
      502,
      'INVALID_MODEL_RESPONSE',
      'AI returned an unreadable response format. Please click Generate again.',
    );
  }

  const rawAssignments = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
  if (rawAssignments.length === 0) {
    throw new AiTimetableHttpError(
      502,
      'EMPTY_TIMETABLE',
      'AI did not return any scheduled periods. Ensure subjects and teachers are assigned and try again.',
    );
  }

  const seenClassDayPeriod = new Set<string>();
  const usedTeacherSlots: Array<{ dayOfWeek: string; startTime: string; endTime: string; teacherId: string }> =
    busyOtherSlots
      .filter((b) => Boolean(b.teacherId))
      .map((b) => ({
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
        teacherId: b.teacherId || '',
      }));
  const usedRoomSlots: Array<{ dayOfWeek: string; startTime: string; endTime: string; roomId: string }> =
    busyOtherSlots
      .filter((b) => Boolean(b.roomId))
      .map((b) => ({
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
        roomId: b.roomId || '',
      }));

  const normalizedPeriods: AiGeneratedPeriodItem[] = [];

  for (const item of rawAssignments) {
    const classId = typeof item.classId === 'string' ? item.classId.trim() : '';
    const cls = classMap.get(classId);
    if (!cls) continue;

    const dayOfWeek = typeof item.dayOfWeek === 'string' ? item.dayOfWeek.trim() : '';
    if (!workingDays.includes(dayOfWeek)) continue;

    const periodNumber = Number(item.periodNumber);
    const slotCfg = slotByPeriodNumber.get(periodNumber);
    if (!slotCfg) continue;

    const dedupeKey = `${cls.id}::${dayOfWeek}::${periodNumber}`;
    if (seenClassDayPeriod.has(dedupeKey)) continue;
    seenClassDayPeriod.add(dedupeKey);

    // Resolve verified subject
    const rawSubId = typeof item.subjectId === 'string' ? item.subjectId.trim() : '';
    const rawSubName = typeof item.subjectName === 'string' ? item.subjectName.trim() : '';
    const matchedSub =
      subjectMap.get(rawSubId) ||
      allSubjects.find(
        (s) => s.classId === cls.id && s.name.toLowerCase() === rawSubName.toLowerCase(),
      ) ||
      allSubjects.find((s) => s.name.toLowerCase() === rawSubName.toLowerCase());

    const subjectId = matchedSub?.id || '';
    const subjectName = (matchedSub?.name || rawSubName || 'General Study').slice(0, 100);

    // Resolve verified teacher and guard against overlapping double-bookings
    const rawTchId = typeof item.teacherId === 'string' ? item.teacherId.trim() : '';
    const rawTchName = typeof item.teacherName === 'string' ? item.teacherName.trim() : '';
    let matchedTeacher =
      teacherMap.get(rawTchId) ||
      (matchedSub?.teacherId ? teacherMap.get(matchedSub.teacherId) : undefined) ||
      allTeachers.find((t) => t.name.toLowerCase() === rawTchName.toLowerCase());

    const isTeacherBusy = (tid: string) =>
      usedTeacherSlots.some(
        (u) =>
          u.teacherId === tid &&
          u.dayOfWeek === dayOfWeek &&
          timesOverlap(slotCfg.startTime, slotCfg.endTime, u.startTime, u.endTime),
      );

    if (matchedTeacher && isTeacherBusy(matchedTeacher.id)) {
      // Try finding an available teacher who teaches the same subject
      const subLower = subjectName.toLowerCase();
      const altTeacher = allTeachers.find(
        (t) =>
          !isTeacherBusy(t.id) &&
          Array.isArray(t.subjects) &&
          t.subjects.some((s) => s.toLowerCase() === subLower),
      );
      matchedTeacher = altTeacher;
    }

    const teacherId = matchedTeacher?.id || '';
    const teacherName = (matchedTeacher?.name || '').slice(0, 120);
    if (teacherId) {
      usedTeacherSlots.push({
        dayOfWeek,
        startTime: slotCfg.startTime,
        endTime: slotCfg.endTime,
        teacherId,
      });
    }

    // Resolve verified room and guard against room overlaps
    const rawRoomId = typeof item.roomId === 'string' ? item.roomId.trim() : '';
    const rawRoomName = typeof item.roomName === 'string' ? item.roomName.trim() : '';
    let matchedRoom =
      roomMap.get(rawRoomId) ||
      (cls.roomId ? roomMap.get(cls.roomId) : undefined) ||
      allRooms.find((r) => r.name.toLowerCase() === rawRoomName.toLowerCase());

    const isRoomBusy = (rid: string) =>
      usedRoomSlots.some(
        (u) =>
          u.roomId === rid &&
          u.dayOfWeek === dayOfWeek &&
          timesOverlap(slotCfg.startTime, slotCfg.endTime, u.startTime, u.endTime),
      );

    if (matchedRoom && isRoomBusy(matchedRoom.id)) {
      matchedRoom = allRooms.find((r) => !isRoomBusy(r.id));
    }

    const roomId = matchedRoom?.id || '';
    const roomName = (matchedRoom?.name || '').slice(0, 80);
    if (roomId) {
      usedRoomSlots.push({
        dayOfWeek,
        startTime: slotCfg.startTime,
        endTime: slotCfg.endTime,
        roomId,
      });
    }

    normalizedPeriods.push({
      classId: cls.id,
      className: cls.name.slice(0, 80),
      dayOfWeek,
      periodNumber,
      startTime: slotCfg.startTime,
      endTime: slotCfg.endTime,
      isBreak: false,
      subjectId,
      subjectName,
      teacherId,
      teacherName,
      roomId,
      roomName,
    });
  }

  normalizedPeriods.sort(
    (a, b) =>
      a.className.localeCompare(b.className) ||
      workingDays.indexOf(a.dayOfWeek) - workingDays.indexOf(b.dayOfWeek) ||
      a.periodNumber - b.periodNumber,
  );

  return {
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 400)
        : `Generated ${normalizedPeriods.length} conflict-checked teaching periods across ${targetClasses.length} ${targetClasses.length === 1 ? 'class' : 'classes'}.`,
    periods: normalizedPeriods,
  };
}

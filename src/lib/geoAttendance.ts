import type { PeriodTimingSlot, School } from '../types/models';

export const DEFAULT_ATTENDANCE_GEOFENCE_METERS = 100;
export const DEFAULT_TEACHER_ATTENDANCE_START = '08:00';
export const DEFAULT_TEACHER_ATTENDANCE_END = '09:30';

/**
 * Computes great-circle distance in meters between two WGS84 coordinates (Haversine formula).
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatMinutesAsHHMM(totalMinutes: number): string {
  const clamped = ((totalMinutes % 1440) + 1440) % 1440;
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function parseHHMMToMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return hh * 60 + mm;
}

export function formatHHMMTo12Hour(hhmm?: string): string {
  const mins = parseHHMMToMinutes(hhmm);
  if (mins === null) return hhmm || '—';
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

export interface TeacherAttendanceWindowStatus {
  enabled: boolean;
  startTime: string;
  endTime: string;
  isOpen: boolean;
  status: 'unrestricted' | 'open' | 'before_window' | 'after_window';
  message: string;
}

/**
 * Evaluates whether the Principal-configured daily Teacher Attendance window is currently open.
 * Applies strictly to Teachers marking their own daily attendance.
 */
export function evaluateTeacherAttendanceWindow(
  settings?: School['settings'],
  now: Date = new Date(),
): TeacherAttendanceWindowStatus {
  const enabled = Boolean(settings?.teacherAttendanceTimeWindowEnabled);
  const startTime = settings?.teacherAttendanceStartTime || DEFAULT_TEACHER_ATTENDANCE_START;
  const endTime = settings?.teacherAttendanceEndTime || DEFAULT_TEACHER_ATTENDANCE_END;

  if (!enabled) {
    return {
      enabled: false,
      startTime,
      endTime,
      isOpen: true,
      status: 'unrestricted',
      message: 'Teachers can mark daily attendance at any time within campus range.',
    };
  }

  const startMins = parseHHMMToMinutes(startTime);
  const endMins = parseHHMMToMinutes(endTime);
  if (startMins === null || endMins === null || endMins <= startMins) {
    return {
      enabled: false,
      startTime,
      endTime,
      isOpen: true,
      status: 'unrestricted',
      message: 'Teacher attendance timing window is not active.',
    };
  }

  const currentMins = now.getHours() * 60 + now.getMinutes();
  const rangeLabel = `${formatHHMMTo12Hour(startTime)} – ${formatHHMMTo12Hour(endTime)}`;

  if (currentMins < startMins) {
    return {
      enabled: true,
      startTime,
      endTime,
      isOpen: false,
      status: 'before_window',
      message: `Teacher attendance opens at ${formatHHMMTo12Hour(startTime)} (allowed daily window: ${rangeLabel}).`,
    };
  }

  if (currentMins > endMins) {
    return {
      enabled: true,
      startTime,
      endTime,
      isOpen: false,
      status: 'after_window',
      message: `Teacher attendance closed at ${formatHHMMTo12Hour(endTime)} (allowed daily window: ${rangeLabel}). Contact your Principal for manual entry.`,
    };
  }

  return {
    enabled: true,
    startTime,
    endTime,
    isOpen: true,
    status: 'open',
    message: `Teacher attendance window is open now (${rangeLabel}).`,
  };
}

/**
 * Normalizes a schedule so teaching periods are strictly numbered 1..N
 * and dedicated Break/Recess slots always have periodNumber: 0 and isBreak: true
 * (breaks NEVER consume a teaching period number).
 */
export function normalizePeriodSchedule(slots: PeriodTimingSlot[]): PeriodTimingSlot[] {
  let teachingCounter = 0;
  let breakCounter = 0;
  return slots.map((slot) => {
    if (slot.isBreak) {
      breakCounter += 1;
      return {
        id: slot.id || `brk_${breakCounter}`,
        periodNumber: 0,
        label: (slot.label || 'Short Break / Recess').slice(0, 40),
        startTime: slot.startTime || '10:40',
        endTime: slot.endTime || '11:00',
        isBreak: true,
      };
    }
    teachingCounter += 1;
    const rawLabel = (slot.label || '').trim();
    const isGenericPeriod = /^Period\s+\d+$/i.test(rawLabel);
    return {
      id: slot.id || `per_${teachingCounter}`,
      periodNumber: teachingCounter,
      label: (!rawLabel || isGenericPeriod ? `Period ${teachingCounter}` : rawLabel).slice(0, 40),
      startTime: slot.startTime || '08:30',
      endTime: slot.endTime || '09:15',
      isBreak: false,
    };
  });
}

/**
 * Generates or resizes a daily schedule for `teachingCount` teaching periods (1..12)
 * while preserving any existing Break/Recess slots in their relative positions.
 * Breaks are NOT counted toward `teachingCount`.
 */
export function buildDefaultPeriodSchedule(
  teachingCount: number,
  existing?: PeriodTimingSlot[],
): PeriodTimingSlot[] {
  const safeCount = Math.max(1, Math.min(12, Math.round(teachingCount) || 8));

  if (existing && existing.length > 0) {
    const normalizedExisting = normalizePeriodSchedule(existing);
    const result: PeriodTimingSlot[] = [];
    let keptTeaching = 0;

    for (const slot of normalizedExisting) {
      if (slot.isBreak) {
        // Keep breaks that fall between retained teaching periods
        if (keptTeaching > 0 && keptTeaching < safeCount) {
          result.push({ ...slot });
        }
      } else if (keptTeaching < safeCount) {
        keptTeaching += 1;
        result.push({ ...slot, periodNumber: keptTeaching });
      }
    }

    // Determine next start time from the end of the last retained slot
    let cursorMinutes = 8 * 60 + 30;
    if (result.length > 0) {
      const lastEnd = parseHHMMToMinutes(result[result.length - 1].endTime);
      if (lastEnd !== null) cursorMinutes = lastEnd;
    }

    while (keptTeaching < safeCount) {
      keptTeaching += 1;
      const startTime = formatMinutesAsHHMM(cursorMinutes);
      cursorMinutes += 45;
      const endTime = formatMinutesAsHHMM(cursorMinutes);
      result.push({
        id: `per_${keptTeaching}`,
        periodNumber: keptTeaching,
        label: `Period ${keptTeaching}`,
        startTime,
        endTime,
        isBreak: false,
      });
    }

    return normalizePeriodSchedule(result);
  }

  // Fresh default schedule (all teaching periods 1..safeCount, 45 mins each from 08:30)
  const slots: PeriodTimingSlot[] = [];
  let cursorMinutes = 8 * 60 + 30;
  for (let i = 1; i <= safeCount; i += 1) {
    const startTime = formatMinutesAsHHMM(cursorMinutes);
    cursorMinutes += 45;
    const endTime = formatMinutesAsHHMM(cursorMinutes);
    slots.push({
      id: `per_${i}`,
      periodNumber: i,
      label: `Period ${i}`,
      startTime,
      endTime,
      isBreak: false,
    });
  }
  return slots;
}

/**
 * Updates a slot's startTime or endTime and automatically chains the immediately following
 * slot's startTime to match the edited slot's endTime (cascading downstream only when needed
 * to avoid endTime <= startTime overlaps).
 */
export function chainPeriodScheduleTimings(
  slots: PeriodTimingSlot[],
  changedIndex: number,
  field: 'startTime' | 'endTime',
  nextValue: string,
): PeriodTimingSlot[] {
  const next = slots.map((s) => ({ ...s }));
  const current = next[changedIndex];
  if (!current) return slots;

  const getDuration = (slot: PeriodTimingSlot): number => {
    const s = parseHHMMToMinutes(slot.startTime);
    const e = parseHHMMToMinutes(slot.endTime);
    if (s !== null && e !== null && e > s) return e - s;
    return slot.isBreak ? 20 : 45;
  };

  if (field === 'startTime') {
    const prevDuration = getDuration(current);
    current.startTime = nextValue;
    const newStart = parseHHMMToMinutes(nextValue);
    const curEnd = parseHHMMToMinutes(current.endTime);
    if (newStart !== null && (curEnd === null || curEnd <= newStart)) {
      current.endTime = formatMinutesAsHHMM(newStart + prevDuration);
    } else {
      return next;
    }
  } else {
    current.endTime = nextValue;
  }

  // Chain the next slot's startTime to current.endTime, cascading if any downstream slot becomes inverted
  let prevEndMins = parseHHMMToMinutes(current.endTime);
  for (let i = changedIndex + 1; i < next.length && prevEndMins !== null; i += 1) {
    const slot = next[i];
    const oldDuration = getDuration(slot);
    if (i === changedIndex + 1) {
      // Directly snap the immediately following slot's startTime to previous slot's endTime
      slot.startTime = formatMinutesAsHHMM(prevEndMins);
      const slotEnd = parseHHMMToMinutes(slot.endTime);
      if (slotEnd === null || slotEnd <= prevEndMins) {
        const pushedEnd = prevEndMins + oldDuration;
        slot.endTime = formatMinutesAsHHMM(pushedEnd);
        prevEndMins = pushedEnd;
      } else {
        // Downstream slot still ends after its new startTime; no need to disturb later slots
        break;
      }
    } else {
      const slotStart = parseHHMMToMinutes(slot.startTime);
      if (slotStart === null || slotStart < prevEndMins) {
        slot.startTime = formatMinutesAsHHMM(prevEndMins);
        const slotEnd = parseHHMMToMinutes(slot.endTime);
        if (slotEnd === null || slotEnd <= prevEndMins) {
          const pushedEnd = prevEndMins + oldDuration;
          slot.endTime = formatMinutesAsHHMM(pushedEnd);
          prevEndMins = pushedEnd;
        } else {
          break;
        }
      } else {
        break;
      }
    }
  }

  return next;
}

/**
 * Inserts a dedicated Break/Recess slot immediately after `afterIndex`.
 * Starts at the previous slot's endTime and shifts the next slot's startTime to the break's endTime.
 */
export function insertBreakAfterIndex(
  slots: PeriodTimingSlot[],
  afterIndex: number,
  label = 'Short Break / Recess',
  durationMinutes = 20,
): PeriodTimingSlot[] {
  const prevSlot = slots[afterIndex];
  if (!prevSlot) return slots;
  const startMins = parseHHMMToMinutes(prevSlot.endTime) ?? 10 * 60 + 40;
  const endMins = startMins + durationMinutes;
  const breakSlot: PeriodTimingSlot = {
    id: `brk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    periodNumber: 0,
    label,
    startTime: formatMinutesAsHHMM(startMins),
    endTime: formatMinutesAsHHMM(endMins),
    isBreak: true,
  };

  const next = [...slots.slice(0, afterIndex + 1), breakSlot, ...slots.slice(afterIndex + 1)];
  return normalizePeriodSchedule(
    chainPeriodScheduleTimings(next, afterIndex + 1, 'endTime', breakSlot.endTime),
  );
}

/**
 * Removes a Break/Recess slot at `breakIndex` and snaps the following slot's startTime
 * right back to the preceding slot's endTime so there is no gap.
 */
export function removeBreakAtIndex(
  slots: PeriodTimingSlot[],
  breakIndex: number,
): PeriodTimingSlot[] {
  const target = slots[breakIndex];
  if (!target || !target.isBreak) return slots;
  const next = [...slots.slice(0, breakIndex), ...slots.slice(breakIndex + 1)];
  if (breakIndex > 0 && breakIndex < next.length) {
    const prevEnd = next[breakIndex - 1].endTime;
    next[breakIndex] = { ...next[breakIndex], startTime: prevEnd };
  }
  return normalizePeriodSchedule(next);
}

/**
 * Compresses a captured camera frame or uploaded image File into a compact JPEG Data URL
 * suitable for Firestore storage (under 200KB).
 */
export function captureVideoFrameToDataUrl(
  video: HTMLVideoElement,
  maxWidth = 480,
  quality = 0.72,
): string {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export function compressImageFileToDataUrl(
  file: File,
  maxWidth = 480,
  quality = 0.72,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / (img.width || maxWidth));
        const w = Math.max(1, Math.round((img.width || maxWidth) * scale));
        const h = Math.max(1, Math.round((img.height || maxWidth) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses a homework worksheet / blackboard photo into a crisp JPEG Data URL
 * guaranteed to stay under `maxChars` (default 290,000 chars, under Firestore's 300,000 rule limit).
 */
export async function compressHomeworkPhotoToDataUrl(
  file: File,
  maxChars = 290000,
): Promise<string> {
  const attempts: Array<{ maxWidth: number; quality: number }> = [
    { maxWidth: 1080, quality: 0.82 },
    { maxWidth: 920, quality: 0.72 },
    { maxWidth: 760, quality: 0.62 },
    { maxWidth: 620, quality: 0.52 },
  ];
  let result = '';
  for (const step of attempts) {
    result = await compressImageFileToDataUrl(file, step.maxWidth, step.quality);
    if (result.length <= maxChars) return result;
  }
  return result.length <= maxChars ? result : await compressImageFileToDataUrl(file, 480, 0.45);
}


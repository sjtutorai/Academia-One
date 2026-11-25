import type { PeriodTimingSlot } from '../types/models';

export const DEFAULT_ATTENDANCE_GEOFENCE_METERS = 100;

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

/**
 * Generates clean sequential period timings starting at 08:30 (45 minutes each)
 * preserving any existing period entries when resizing the number of periods per day.
 */
export function buildDefaultPeriodSchedule(
  count: number,
  existing?: PeriodTimingSlot[],
): PeriodTimingSlot[] {
  const safeCount = Math.max(1, Math.min(12, Math.round(count) || 8));
  const existingMap = new Map<number, PeriodTimingSlot>();
  (existing || []).forEach((slot) => {
    if (slot && typeof slot.periodNumber === 'number') {
      existingMap.set(slot.periodNumber, slot);
    }
  });

  const slots: PeriodTimingSlot[] = [];
  let cursorMinutes = 8 * 60 + 30; // 08:30 default start

  for (let i = 1; i <= safeCount; i += 1) {
    const prev = existingMap.get(i);
    if (prev && prev.startTime && prev.endTime) {
      slots.push({
        periodNumber: i,
        label: (prev.label || (prev.isBreak ? 'Break / Recess' : `Period ${i}`)).slice(0, 40),
        startTime: prev.startTime,
        endTime: prev.endTime,
        isBreak: Boolean(prev.isBreak),
      });
      const [eh, em] = prev.endTime.split(':').map(Number);
      if (Number.isFinite(eh) && Number.isFinite(em)) {
        cursorMinutes = eh * 60 + em;
      } else {
        cursorMinutes += 45;
      }
    } else {
      const startTime = formatMinutesAsHHMM(cursorMinutes);
      cursorMinutes += 45;
      const endTime = formatMinutesAsHHMM(cursorMinutes);
      slots.push({
        periodNumber: i,
        label: `Period ${i}`,
        startTime,
        endTime,
        isBreak: false,
      });
    }
  }
  return slots;
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

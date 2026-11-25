import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Camera,
  CheckCircle2,
  Download,
  MapPin,
  Pencil,
  Search,
  Settings,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { exportToCsv } from '../../lib/csv';
import { recordAuditLog } from '../../lib/audit';
import { DEFAULT_ATTENDANCE_GEOFENCE_METERS } from '../../lib/geoAttendance';
import {
  Button,
  EmptyState,
  Modal,
  StatCard,
  StatusText,
  useToast,
} from '../../components/ui/Primitives';
import type {
  PlatformUser,
  School,
  TeacherAttendanceRecord,
  TeacherProfile,
} from '../../types/models';

const STATUS_OPTIONS: { value: TeacherAttendanceRecord['status']; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'half_day', label: 'Half Day' },
  { value: 'absent', label: 'Absent' },
  { value: 'on_leave', label: 'On Leave' },
];

export function PrincipalTeacherAttendanceView({
  school,
  teachers,
  teacherAttendance,
  actor,
  canWrite,
  globalSearch = '',
}: {
  school: School;
  teachers: TeacherProfile[];
  teacherAttendance: TeacherAttendanceRecord[];
  actor: PlatformUser;
  canWrite: boolean;
  globalSearch?: string;
}) {
  const { pushToast } = useToast();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [localSearch, setLocalSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editTeacher, setEditTeacher] = useState<TeacherProfile | null>(null);
  const [editStatus, setEditStatus] = useState<TeacherAttendanceRecord['status']>('present');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoPreviewRecord, setPhotoPreviewRecord] = useState<TeacherAttendanceRecord | null>(null);

  const geofenceRadius = school.settings?.attendanceGeofenceMeters || DEFAULT_ATTENDANCE_GEOFENCE_METERS;
  const hasCampusCoords =
    typeof school.settings?.campusLatitude === 'number' &&
    typeof school.settings?.campusLongitude === 'number';

  const dateRecordByTeacherId = useMemo(() => {
    const map = new Map<string, TeacherAttendanceRecord>();
    teacherAttendance
      .filter((r) => r.date === selectedDate)
      .forEach((r) => {
        map.set(r.teacherId, r);
      });
    return map;
  }, [teacherAttendance, selectedDate]);

  const rows = useMemo(() => {
    const q = (localSearch || globalSearch).trim().toLowerCase();
    return teachers
      .map((t) => ({
        teacher: t,
        record: dateRecordByTeacherId.get(t.id) || null,
      }))
      .filter(({ teacher, record }) => {
        if (q && !`${teacher.name} ${teacher.staffId} ${teacher.email}`.toLowerCase().includes(q)) {
          return false;
        }
        if (statusFilter === 'unmarked') return !record;
        if (statusFilter !== 'all') return record?.status === statusFilter;
        return true;
      })
      .sort((a, b) => a.teacher.name.localeCompare(b.teacher.name));
  }, [teachers, dateRecordByTeacherId, localSearch, globalSearch, statusFilter]);

  const stats = useMemo(() => {
    let present = 0;
    let lateOrHalf = 0;
    let absentOrLeave = 0;
    let unmarked = 0;
    teachers.forEach((t) => {
      const rec = dateRecordByTeacherId.get(t.id);
      if (!rec) {
        unmarked += 1;
      } else if (rec.status === 'present') {
        present += 1;
      } else if (rec.status === 'late' || rec.status === 'half_day') {
        lateOrHalf += 1;
      } else {
        absentOrLeave += 1;
      }
    });
    return { present, lateOrHalf, absentOrLeave, unmarked };
  }, [teachers, dateRecordByTeacherId]);

  const openEditModal = (teacher: TeacherProfile) => {
    const existing = dateRecordByTeacherId.get(teacher.id);
    setEditTeacher(teacher);
    setEditStatus(existing?.status || 'present');
    setEditNotes(existing?.notes || '');
  };

  const handleSavePrincipalMark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTeacher || !canWrite) return;
    setSaving(true);
    const existing = dateRecordByTeacherId.get(editTeacher.id);
    const recordId = existing?.id || `tatt_${school.id}_${editTeacher.id}_${selectedDate}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
      if (existing) {
        await updateDoc(doc(db, 'teacherAttendance', recordId), {
          status: editStatus,
          notes: editNotes.trim().slice(0, 500),
          markedBy: 'principal',
          markedByUid: actor.uid,
          markedByName: actor.displayName,
          updatedAt: serverTimestamp(),
        });
      } else {
        const payload: Record<string, unknown> = {
          id: recordId,
          schoolId: school.id,
          teacherId: editTeacher.id,
          teacherUid: editTeacher.userId || '',
          teacherName: editTeacher.name,
          staffId: editTeacher.staffId || '',
          date: selectedDate,
          status: editStatus,
          checkInTime: editStatus === 'present' || editStatus === 'late' || editStatus === 'half_day' ? nowTime : '',
          withinRange: true,
          markedBy: 'principal',
          markedByUid: actor.uid,
          markedByName: actor.displayName,
          notes: editNotes.trim().slice(0, 500),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'teacherAttendance', recordId), payload);
      }

      await recordAuditLog({
        schoolId: school.id,
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action: 'MARK_TEACHER_ATTENDANCE',
        targetType: 'teacherAttendance',
        targetId: recordId,
        targetLabel: `${editTeacher.name} (${selectedDate})`,
        details: `Principal marked teacher attendance as ${editStatus}${editNotes.trim() ? `: ${editNotes.trim()}` : ''}.`,
      }).catch(() => undefined);

      pushToast('success', `Marked ${editTeacher.name} as ${editStatus.replace(/_/g, ' ')} for ${selectedDate}.`);
      setEditTeacher(null);
    } catch (err) {
      handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, `teacherAttendance/${recordId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Geofence Status Banner */}
      <div
        className={`rounded-xl border px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 ${
          hasCampusCoords
            ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70'
            : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {hasCampusCoords ? (
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          )}
          <div className="text-xs">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {hasCampusCoords
                ? `Campus Geofence Active · ${geofenceRadius}m radius with live photo verification`
                : 'Campus GPS Location Not Configured Yet'}
            </p>
            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
              {hasCampusCoords
                ? `School pin: ${school.settings?.campusLatitude?.toFixed(5)}, ${school.settings?.campusLongitude?.toFixed(5)}. Teachers must check in within ${geofenceRadius} meters with a live photo.`
                : 'Set your school campus latitude and longitude in School Settings so teachers can mark geofenced attendance within 100 meters.'}
            </p>
          </div>
        </div>
        <Link
          to="/principal/settings"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline shrink-0"
        >
          <Settings className="w-3.5 h-3.5" />
          Configure Geofence
        </Link>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Present" value={stats.present} subtext={`On ${selectedDate}`} tone="green" />
        <StatCard label="Late / Half Day" value={stats.lateOrHalf} subtext="Partial or delayed check-in" tone="yellow" />
        <StatCard label="Absent / On Leave" value={stats.absentOrLeave} subtext="Away from campus" tone="red" />
        <StatCard label="Not Marked Yet" value={stats.unmarked} subtext={`Out of ${teachers.length} teachers`} tone="blue" />
      </div>

      {/* Controls Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search teacher or staff ID…"
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 w-52"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All Statuses</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="half_day">Half Day</option>
            <option value="absent">Absent</option>
            <option value="on_leave">On Leave</option>
            <option value="unmarked">Unmarked</option>
          </select>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            exportToCsv(
              `teacher_attendance_${selectedDate}.csv`,
              ['Date', 'Staff ID', 'Teacher Name', 'Status', 'Check-in Time', 'Distance (m)', 'Within Range', 'Marked By', 'Notes'],
              rows.map(({ teacher, record }) => [
                selectedDate,
                teacher.staffId,
                teacher.name,
                record?.status || 'unmarked',
                record?.checkInTime || '',
                record?.distanceMeters ?? '',
                record?.withinRange === true ? 'Yes' : record?.withinRange === false ? 'No' : '',
                record ? `${record.markedBy} (${record.markedByName})` : '',
                record?.notes || '',
              ]),
            )
          }
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Attendance Table */}
      {teachers.length === 0 ? (
        <EmptyState
          title="No teachers registered yet"
          description="Add faculty members in the Teachers directory to track geofenced photo check-ins and daily staff attendance."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No matching teachers"
          description="Try clearing the search query or status filter to see all staff members."
        />
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/70 text-xs text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-semibold">Teacher &amp; Staff ID</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Check-In &amp; Source</th>
                <th className="py-3 px-4 font-semibold">GPS Verification</th>
                <th className="py-3 px-4 font-semibold">Photo</th>
                <th className="py-3 px-4 font-semibold text-right">Principal Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(({ teacher, record }) => (
                <tr key={teacher.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{teacher.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {teacher.staffId} · {teacher.email}
                    </p>
                  </td>
                  <td className="py-3 px-4">
                    {record ? (
                      <StatusText status={record.status} />
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Unmarked</span>
                    )}
                    {record?.notes && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-[200px] truncate">
                        {record.notes}
                      </p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300">
                    {record ? (
                      <>
                        <p className="font-mono font-medium tabular-nums">{record.checkInTime || '—'}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {record.markedBy === 'teacher' ? 'Self Check-in' : `Marked by Principal (${record.markedByName})`}
                        </p>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {record && typeof record.distanceMeters === 'number' ? (
                      <span
                        className={`inline-flex items-center gap-1 font-mono tabular-nums font-medium ${
                          record.withinRange
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        {Math.round(record.distanceMeters)}m · {record.withinRange ? `Within ${geofenceRadius}m` : 'Out of range'}
                      </span>
                    ) : record?.markedBy === 'principal' ? (
                      <span className="text-slate-500 dark:text-slate-400">Principal entry</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {record?.photoDataUrl ? (
                      <button
                        type="button"
                        onClick={() => setPhotoPreviewRecord(record)}
                        className="group relative w-11 h-11 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hover:border-blue-500 transition-colors cursor-pointer"
                        title="Inspect attendance verification photo"
                      >
                        <img
                          src={record.photoDataUrl}
                          alt={`${teacher.name} check-in`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500 inline-flex items-center gap-1">
                        <Camera className="w-3.5 h-3.5" /> None
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      variant={record ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={!canWrite}
                      onClick={() => openEditModal(teacher)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {record ? 'Edit' : 'Mark'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Principal Mark / Override Modal */}
      <Modal
        open={Boolean(editTeacher)}
        onClose={() => setEditTeacher(null)}
        title={editTeacher ? `Staff Attendance · ${editTeacher.name}` : 'Mark Attendance'}
        subtitle={`Date: ${selectedDate}`}
        maxWidth="max-w-md"
      >
        {editTeacher && (
          <form onSubmit={handleSavePrincipalMark} className="space-y-4">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs">
              <p className="font-semibold text-slate-900 dark:text-slate-100">{editTeacher.name}</p>
              <p className="text-slate-500 dark:text-slate-400 font-mono">
                {editTeacher.staffId} · {editTeacher.email}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Attendance Status
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEditStatus(opt.value)}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      editStatus === opt.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Principal Note (Optional)
              </label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Approved medical leave, field duty, manual check-in verification…"
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditTeacher(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={saving}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Save Attendance
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Captured Photo Verification Inspection Modal */}
      <Modal
        open={Boolean(photoPreviewRecord)}
        onClose={() => setPhotoPreviewRecord(null)}
        title={photoPreviewRecord ? `${photoPreviewRecord.teacherName} — Check-in Photo` : 'Verification Photo'}
        subtitle={
          photoPreviewRecord
            ? `${photoPreviewRecord.date} · Check-in ${photoPreviewRecord.checkInTime || '—'}`
            : undefined
        }
        maxWidth="max-w-lg"
      >
        {photoPreviewRecord && (
          <div className="space-y-4">
            {photoPreviewRecord.photoDataUrl && (
              <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950">
                <img
                  src={photoPreviewRecord.photoDataUrl}
                  alt={`${photoPreviewRecord.teacherName} attendance verification`}
                  className="w-full max-h-[420px] object-contain mx-auto"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-xs p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
              <div>
                <p className="text-slate-500 dark:text-slate-400">Status</p>
                <div className="mt-0.5"><StatusText status={photoPreviewRecord.status} /></div>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Distance from Campus</p>
                <p className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                  {typeof photoPreviewRecord.distanceMeters === 'number'
                    ? `${Math.round(photoPreviewRecord.distanceMeters)} meters`
                    : 'Not recorded'}
                </p>
              </div>
              {typeof photoPreviewRecord.latitude === 'number' && typeof photoPreviewRecord.longitude === 'number' && (
                <div className="col-span-2">
                  <p className="text-slate-500 dark:text-slate-400">GPS Coordinates</p>
                  <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5 tabular-nums">
                    {photoPreviewRecord.latitude.toFixed(6)}, {photoPreviewRecord.longitude.toFixed(6)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

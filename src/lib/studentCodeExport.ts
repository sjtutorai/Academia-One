import * as XLSX from 'xlsx';
import { exportToCsv } from './csv';
import { buildStudentFourCodePack } from './schoolCodes';
import type { SchoolClass, StudentProfile, TeacherProfile } from '../types/models';

export interface ClassStudentCodeRow {
  rollNumber: string;
  studentName: string;
  admissionNumber: string;
  schoolCode: string;
  classCode: string;
  className: string;
  teacherCode: string;
  teacherName: string;
  studentCode: string;
  status: string;
}

export function buildClassStudentCodeRows(params: {
  cls: SchoolClass;
  students: StudentProfile[];
  teachers: TeacherProfile[];
  schoolCode: string;
  schoolName: string;
}): ClassStudentCodeRow[] {
  const { cls, students, teachers, schoolCode, schoolName } = params;
  const classStudents = students
    .filter((s) => s.classId === cls.id)
    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

  return classStudents.map((st) => {
    const pack = buildStudentFourCodePack({
      schoolCode,
      schoolName,
      student: st,
      classes: [cls],
      teachers,
    });
    return {
      rollNumber: st.rollNumber || '',
      studentName: st.name,
      admissionNumber: st.admissionNumber || '',
      schoolCode: pack.schoolCode || schoolCode,
      classCode: pack.classCode || cls.code,
      className: cls.name,
      teacherCode: pack.teacherCode || '',
      teacherName: pack.teacherName || cls.classTeacherName || '',
      studentCode: pack.studentCode || st.accessCode || '',
      status: st.status,
    };
  });
}

function safeFileSlug(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'class';
}

export function downloadStudentCodesExcel(params: {
  cls: SchoolClass;
  students: StudentProfile[];
  teachers: TeacherProfile[];
  schoolCode: string;
  schoolName: string;
}): number {
  const rows = buildClassStudentCodeRows(params);
  const sheetData = rows.map((r) => ({
    'Roll No': r.rollNumber,
    'Student Name': r.studentName,
    'Admission No': r.admissionNumber,
    'School Code': r.schoolCode,
    'Class & Section': r.className,
    'Class Code': r.classCode,
    'Class Teacher': r.teacherName || 'Unassigned',
    'Teacher Code': r.teacherCode || 'Unassigned',
    'Student Access Code': r.studentCode || 'Not Assigned',
    Status: r.status,
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 10 },
    { wch: 24 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 12 },
    { wch: 20 },
    { wch: 15 },
    { wch: 20 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, params.cls.code.slice(0, 31) || 'StudentCodes');
  const filename = `SJ_Academia_One_${safeFileSlug(params.cls.code)}_Student_Codes.xlsx`;
  XLSX.writeFile(wb, filename);
  return rows.length;
}

export function downloadStudentCodesCsv(params: {
  cls: SchoolClass;
  students: StudentProfile[];
  teachers: TeacherProfile[];
  schoolCode: string;
  schoolName: string;
}): number {
  const rows = buildClassStudentCodeRows(params);
  const filename = `SJ_Academia_One_${safeFileSlug(params.cls.code)}_Student_Codes.csv`;
  exportToCsv(
    filename,
    [
      'Roll No',
      'Student Name',
      'Admission No',
      'School Code',
      'Class & Section',
      'Class Code',
      'Class Teacher',
      'Teacher Code',
      'Student Access Code',
      'Status',
    ],
    rows.map((r) => [
      r.rollNumber,
      r.studentName,
      r.admissionNumber,
      r.schoolCode,
      r.className,
      r.classCode,
      r.teacherName || 'Unassigned',
      r.teacherCode || 'Unassigned',
      r.studentCode || 'Not Assigned',
      r.status,
    ]),
  );
  return rows.length;
}

function escapeHtml(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a clean print-to-PDF sheet inside a hidden iframe (no window.open popup)
 * so teachers and principals can save student login codes directly as PDF.
 */
export function downloadStudentCodesPdf(params: {
  cls: SchoolClass;
  students: StudentProfile[];
  teachers: TeacherProfile[];
  schoolCode: string;
  schoolName: string;
}): number {
  const rows = buildClassStudentCodeRows(params);
  const classTeacher = params.cls.classTeacherName || rows[0]?.teacherName || 'Unassigned';
  const teacherCode = rows[0]?.teacherCode || 'Not Assigned';

  const tableRowsHtml =
    rows.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:18px;color:#64748b;">No students enrolled in this class yet.</td></tr>`
      : rows
          .map(
            (r) => `
          <tr>
            <td style="font-family:monospace;">${escapeHtml(r.rollNumber)}</td>
            <td style="font-weight:600;color:#0f172a;">${escapeHtml(r.studentName)}</td>
            <td style="font-family:monospace;">${escapeHtml(r.admissionNumber)}</td>
            <td style="font-family:monospace;font-weight:700;color:#0f295c;">${escapeHtml(r.studentCode || 'Not Assigned')}</td>
            <td style="font-family:monospace;">${escapeHtml(r.classCode)}</td>
            <td style="text-transform:capitalize;">${escapeHtml(r.status)}</td>
          </tr>`,
          )
          .join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.cls.name)} — Student Login Codes</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; margin: 0; }
    .header { border-bottom: 2px solid #0f295c; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
    .title { font-size: 18px; font-weight: 800; color: #0f295c; margin: 0; }
    .sub { font-size: 11px; color: #475569; margin: 4px 0 0; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; background: #f8fafc; }
    .card-label { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
    .card-val { font-size: 13px; font-weight: 700; font-family: monospace; color: #0f295c; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #0f295c; color: #ffffff; text-align: left; padding: 8px; font-weight: 600; }
    td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 14px; font-size: 10px; color: #64748b; text-align: right; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="title">${escapeHtml(params.schoolName || 'SJ Academia One')} — Student Login Codes</h1>
      <p class="sub">${escapeHtml(params.cls.name)} (${escapeHtml(params.cls.code)}) · Class Teacher: ${escapeHtml(classTeacher)}</p>
    </div>
    <div style="text-align:right;font-size:10px;color:#64748b;">
      Generated on ${escapeHtml(new Date().toLocaleDateString())}
    </div>
  </div>
  <div class="meta">
    <div class="card"><div class="card-label">1. School Code</div><div class="card-val">${escapeHtml(params.schoolCode || '—')}</div></div>
    <div class="card"><div class="card-label">2. Class Code</div><div class="card-val">${escapeHtml(params.cls.code)}</div></div>
    <div class="card"><div class="card-label">3. Teacher Code</div><div class="card-val">${escapeHtml(teacherCode)}</div></div>
    <div class="card"><div class="card-label">Students Listed</div><div class="card-val">${rows.length}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Roll</th>
        <th>Student Name</th>
        <th>Admission No.</th>
        <th>4. Student Access Code</th>
        <th>Class Code</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${tableRowsHtml}
    </tbody>
  </table>
  <div class="footer">SJ Academia One · Official Class Student Login Code Directory</div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1500);
      }
    }, 250);
  } else if (iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
  return rows.length;
}

export function exportStudentCodeRowsExcel(params: {
  titleSlug: string;
  sheetName?: string;
  rows: Array<{
    rollNumber: string;
    studentName: string;
    schoolCode: string;
    className: string;
    classCode: string;
    teacherCode: string;
    studentCode: string;
    status: string;
  }>;
}): number {
  const sheetData = params.rows.map((r) => ({
    'Roll No': r.rollNumber,
    'Student Name': r.studentName,
    'School Code': r.schoolCode,
    'Class & Section': r.className,
    'Class Code': r.classCode,
    'Teacher Code': r.teacherCode || 'Unassigned',
    'Student Access Code': r.studentCode || 'Not Assigned',
    Status: r.status,
  }));
  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 10 },
    { wch: 24 },
    { wch: 14 },
    { wch: 22 },
    { wch: 12 },
    { wch: 15 },
    { wch: 20 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (params.sheetName || 'StudentCodes').slice(0, 31));
  XLSX.writeFile(wb, `SJ_Academia_One_${safeFileSlug(params.titleSlug)}_Student_Codes.xlsx`);
  return params.rows.length;
}

export function exportStudentCodeRowsPdf(params: {
  schoolName: string;
  schoolCode: string;
  heading: string;
  subtitle: string;
  rows: Array<{
    rollNumber: string;
    studentName: string;
    className: string;
    classCode: string;
    teacherCode: string;
    studentCode: string;
    status: string;
  }>;
}): number {
  const tableRowsHtml =
    params.rows.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:18px;color:#64748b;">No student codes found.</td></tr>`
      : params.rows
          .map(
            (r) => `
          <tr>
            <td style="font-family:monospace;">${escapeHtml(r.rollNumber)}</td>
            <td style="font-weight:600;color:#0f172a;">${escapeHtml(r.studentName)}</td>
            <td>${escapeHtml(r.className)} (${escapeHtml(r.classCode)})</td>
            <td style="font-family:monospace;">${escapeHtml(r.teacherCode || '—')}</td>
            <td style="font-family:monospace;font-weight:700;color:#0f295c;">${escapeHtml(r.studentCode || 'Not Assigned')}</td>
            <td style="text-transform:capitalize;">${escapeHtml(r.status)}</td>
          </tr>`,
          )
          .join('');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.heading)} — Student Login Codes</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; margin: 0; }
    .header { border-bottom: 2px solid #0f295c; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
    .title { font-size: 18px; font-weight: 800; color: #0f295c; margin: 0; }
    .sub { font-size: 11px; color: #475569; margin: 4px 0 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #0f295c; color: #ffffff; text-align: left; padding: 8px; font-weight: 600; }
    td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 14px; font-size: 10px; color: #64748b; text-align: right; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="title">${escapeHtml(params.schoolName || 'SJ Academia One')} — ${escapeHtml(params.heading)}</h1>
      <p class="sub">${escapeHtml(params.subtitle)} · School Code: ${escapeHtml(params.schoolCode || '—')}</p>
    </div>
    <div style="text-align:right;font-size:10px;color:#64748b;">
      Generated on ${escapeHtml(new Date().toLocaleDateString())}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Roll</th>
        <th>Student Name</th>
        <th>Class & Section</th>
        <th>Teacher Code</th>
        <th>Student Access Code</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${tableRowsHtml}
    </tbody>
  </table>
  <div class="footer">SJ Academia One · Official Student Login Code Directory</div>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (iframeDoc) {
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1500);
      }
    }, 250);
  } else if (iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
  return params.rows.length;
}


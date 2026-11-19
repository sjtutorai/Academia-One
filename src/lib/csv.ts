export interface ParsedCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
  errors: string[];
  isDuplicate: boolean;
}

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

export function validateStudentImportRows(
  rows: Record<string, string>[],
  mapping: {
    admissionNumber: string;
    rollNumber: string;
    name: string;
    email: string;
    classCode: string;
    guardianName: string;
    guardianPhone: string;
  },
  existingAdmissionNumbers: Set<string>,
  validClassCodes: Set<string>,
): ParsedCsvRow[] {
  const seenInBatch = new Set<string>();
  return rows.map((raw, idx) => {
    const errors: string[] = [];
    const adm = (raw[mapping.admissionNumber] || '').trim();
    const roll = (raw[mapping.rollNumber] || '').trim();
    const name = (raw[mapping.name] || '').trim();
    const classCode = (raw[mapping.classCode] || '').trim().toUpperCase();
    const email = (raw[mapping.email] || '').trim();

    if (!adm) errors.push('Missing admission number');
    if (!roll) errors.push('Missing roll number');
    if (name.length < 2) errors.push('Student name must be at least 2 characters');
    if (!classCode) {
      errors.push('Missing class code');
    } else if (validClassCodes.size > 0 && !validClassCodes.has(classCode)) {
      errors.push(`Unknown class code "${classCode}"`);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Invalid email format');
    }

    const isDuplicate = Boolean(adm && (existingAdmissionNumbers.has(adm.toLowerCase()) || seenInBatch.has(adm.toLowerCase())));
    if (isDuplicate) {
      errors.push(`Duplicate admission number "${adm}"`);
    } else if (adm) {
      seenInBatch.add(adm.toLowerCase());
    }

    return { rowNumber: idx + 2, raw, errors, isDuplicate };
  });
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number | boolean | undefined)[][]): void {
  const escapeCell = (val: string | number | boolean | undefined): string => {
    const str = val === undefined || val === null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) => r.map(escapeCell).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadStudentTemplateCsv(sampleClassCode = 'G10A'): void {
  exportToCsv(
    'academiaone_students_template.csv',
    ['admissionNumber', 'rollNumber', 'name', 'email', 'classCode', 'guardianName', 'guardianPhone'],
    [
      ['ADM-2026-101', '15', 'Maya Lin', 'maya.lin@northridge.edu', sampleClassCode, 'David Lin', '+1-555-0192'],
      ['ADM-2026-102', '16', 'Noah Patel', 'noah.patel@northridge.edu', sampleClassCode, 'Priya Patel', '+1-555-0193'],
    ],
  );
}

'use strict';

// Minimal, dependency-free CSV handling tailored to GradeTracker's import/export.
//
// Import/export use a "wide" layout that mirrors a teacher's tracking sheet:
//   - first column  = student name
//   - other columns = one per criterion, headed "<Unit name> | <code>"
//   - a cell is "complete" if it contains x / yes / 1 / done / ✓ (case-insensitive)

const TRUTHY = new Set(['x', 'y', 'yes', '1', 'true', 'done', 'complete', 'c', '✓', '✔']);

function isTruthy(value) {
  return TRUTHY.has(String(value == null ? '' : value).trim().toLowerCase());
}

// Normalise a header so "Unit 1 | P1", "Unit 1 P1" and "unit1-p1" all match.
function normKey(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^﻿/, ''); // strip BOM
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully blank rows.
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function escapeCell(value) {
  const s = String(value == null ? '' : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function stringify(rows) {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = { parse, stringify, isTruthy, normKey };

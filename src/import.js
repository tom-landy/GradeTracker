'use strict';

// Flexible CSV import. Understands two layouts without the user reformatting:
//
//  A) GradeTracker template  — header on the first row, columns headed
//     "Unit 1 | P1", cells marked x / blank.
//
//  B) Teacher tracking sheet — a unit title row (e.g. "Unit 1 Exploring
//     Business"), an assignment row (A1, A2, ...), then a "Students" header row
//     of bare codes (P1, P2, ...), with y/n cells and trailing summary columns
//     (Unit Grade, Unit Points) that are ignored.
//
// "Complete" = y / yes / x / 1 / done / ✓ (and y-typos like yy, yt).
// "Outstanding" = n / r / 0 / blank / anything else.

const { normKey } = require('./csv');

const IGNORABLE = new Set(['unitgrade', 'unitpoints', 'grade', 'points', 'total', 'totalpoints']);

function isComplete(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s) return false;
  if (s[0] === 'n' || s[0] === 'r' || s === '0' || s === 'false') return false;
  if (s[0] === 'y') return true; // y, yes, yy, yt (tolerate typos)
  return ['x', '1', 'true', 'done', 'complete', 'c', '✓', '✔'].includes(s);
}

function buildCriterionIndex(tree) {
  const byLabel = new Map(); // normKey("Unit 1 | P1") -> criterionId
  const byUnitCode = new Map(); // unitId + "::" + normKey(code) -> criterionId
  const unitName = new Map(); // unitId -> display name
  const units = [];
  for (const u of tree) {
    units.push(u);
    unitName.set(u.id, u.name);
    for (const a of u.assignments) {
      for (const c of a.criteria) {
        byLabel.set(normKey(`${u.name} | ${c.code}`), c.id);
        byUnitCode.set(u.id + '::' + normKey(c.code), c.id);
      }
    }
  }
  return { byLabel, byUnitCode, units, unitName };
}

// Match a free-text title like "Unit 1 Exploring Business" to a known unit
// whose name is a prefix ("Unit 1"). Prefer the longest matching unit name.
function resolveUnit(title, units) {
  const t = normKey(title);
  if (!t) return null;
  let best = null;
  let bestLen = -1;
  for (const u of units) {
    const k = normKey(u.name);
    if (k && t.startsWith(k) && k.length > bestLen) {
      best = u;
      bestLen = k.length;
    }
  }
  return best;
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const first = normKey(rows[i][0]);
    if (first === 'student' || first === 'students') return i;
  }
  return 0; // assume the first row is the header
}

// Carry each non-empty cell forward across the row, mimicking merged cells.
function fillForward(row) {
  const out = [];
  let last = '';
  for (let i = 0; i < row.length; i += 1) {
    const v = String(row[i] == null ? '' : row[i]).trim();
    if (v) last = v;
    out[i] = last;
  }
  return out;
}

// Work out which unit each column belongs to, using the title rows above the
// header. Whichever row resolves the most units wins (handles single sheets and
// side-by-side multi-unit sheets).
function unitPerColumn(rows, headerIdx, units) {
  let best = [];
  let bestScore = -1;
  for (let i = 0; i < headerIdx; i += 1) {
    const resolved = fillForward(rows[i]).map((title) => resolveUnit(title, units));
    const score = resolved.filter(Boolean).length;
    if (score > bestScore) {
      bestScore = score;
      best = resolved;
    }
  }
  return best;
}

function parseImport(rows, tree) {
  const { byLabel, byUnitCode, units, unitName } = buildCriterionIndex(tree);
  const headerIdx = findHeaderRow(rows);
  const header = rows[headerIdx] || [];
  const unitCols = unitPerColumn(rows, headerIdx, units);

  const colToCriterion = [];
  const unknownColumns = [];
  const detectedUnitIds = new Set();

  for (let i = 1; i < header.length; i += 1) {
    const raw = String(header[i] == null ? '' : header[i]).trim();
    if (!raw) {
      colToCriterion[i] = null;
      continue;
    }
    // 1) full template label, e.g. "Unit 1 | P1"
    let cid = byLabel.get(normKey(raw)) || null;
    // 2) bare code resolved via the unit title row above
    if (!cid) {
      const unit = unitCols[i];
      if (unit) cid = byUnitCode.get(unit.id + '::' + normKey(raw)) || null;
    }
    colToCriterion[i] = cid;
    if (cid) {
      const unit = unitCols[i];
      if (unit) detectedUnitIds.add(unit.id);
    } else if (!IGNORABLE.has(normKey(raw))) {
      unknownColumns.push(raw);
    }
  }

  // If we matched by template label, derive detected units from the criteria.
  if (detectedUnitIds.size === 0) {
    const idToUnit = new Map();
    for (const u of units) for (const a of u.assignments) for (const c of a.criteria) idToUnit.set(c.id, u.id);
    for (const cid of colToCriterion) if (cid && idToUnit.has(cid)) detectedUnitIds.add(idToUnit.get(cid));
  }

  const records = [];
  for (let r = headerIdx + 1; r < rows.length; r += 1) {
    const row = rows[r];
    const name = String(row[0] == null ? '' : row[0]).trim();
    if (!name) continue;
    const key = normKey(name);
    if (key === 'student' || key === 'students') continue;
    const complete = [];
    const outstanding = [];
    for (let i = 1; i < header.length; i += 1) {
      const cid = colToCriterion[i];
      if (!cid) continue;
      if (isComplete(row[i])) complete.push(cid);
      else outstanding.push(cid);
    }
    records.push({ name, complete, outstanding });
  }

  return {
    records,
    unknownColumns,
    matchedColumns: colToCriterion.filter(Boolean).length,
    detectedUnits: [...detectedUnitIds].map((uid) => unitName.get(uid)).filter(Boolean),
    headerRowIndex: headerIdx,
  };
}

// ---- Workbook (multi-tab .xlsx) parsing -------------------------------------

function isCode(value) {
  return /^[PMD]\d+$/i.test(String(value == null ? '' : value).trim());
}

// "U1 A123" -> "Unit 1", "Unit 8" -> "Unit 8". Null if no unit number found.
function unitNameFromTab(tab) {
  const m = String(tab || '').match(/u(?:nit)?\s*0*([0-9]+)/i);
  return m ? 'Unit ' + m[1] : null;
}

function findHeaderRowIdx(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const lc = rows[i].map((c) => String(c == null ? '' : c).trim().toLowerCase());
    if (lc.includes('surname')) return i;
    if (rows[i].filter(isCode).length >= 3) return i;
  }
  return -1;
}

// Turn the criterion columns into assignments: a run of adjacent criterion
// columns is one assignment; a gap (grade/points column) starts the next.
function groupAssignments(critCols) {
  const groups = [];
  let cur = null;
  for (const cc of critCols) {
    if (cur && cc.col === cur.lastCol + 1) {
      cur.codes.push(cc.code);
      cur.cols.push(cc.col);
      cur.lastCol = cc.col;
    } else {
      cur = { codes: [cc.code], cols: [cc.col], lastCol: cc.col };
      groups.push(cur);
    }
  }
  return groups.map((g, i) => ({ name: 'A' + (i + 1), criteria: g.codes, cols: g.cols }));
}

// Parse criterion-level tabs from a workbook into an import payload:
//   { units: [{ name, assignments:[{name,criteria}], students:[{name,marks}] }],
//     skipped: [{ name, reason }] }
function parseWorkbook(sheets) {
  const units = [];
  const skipped = [];

  for (const sheet of sheets) {
    const unitName = unitNameFromTab(sheet.name);
    if (!unitName) {
      skipped.push({ name: sheet.name, reason: 'not a unit tab' });
      continue;
    }
    const rows = sheet.rows || [];
    const h = findHeaderRowIdx(rows);
    if (h < 0) {
      skipped.push({ name: sheet.name, reason: 'no criteria header found' });
      continue;
    }
    const header = rows[h];
    const critCols = [];
    for (let c = 0; c < header.length; c += 1) {
      if (isCode(header[c])) critCols.push({ col: c, code: String(header[c]).trim().toUpperCase() });
    }
    if (critCols.length === 0) {
      skipped.push({ name: sheet.name, reason: 'no per-criterion columns (summary only)' });
      continue;
    }

    const assignments = groupAssignments(critCols);
    const lc = header.map((c) => String(c == null ? '' : c).trim().toLowerCase());
    const surnameCol = lc.indexOf('surname');
    const firstCol = surnameCol > 0 ? surnameCol - 1 : -1;

    const students = [];
    for (let r = h + 1; r < rows.length; r += 1) {
      const row = rows[r];
      const surname = surnameCol >= 0 ? String(row[surnameCol] == null ? '' : row[surnameCol]).trim() : '';
      const first = firstCol >= 0 ? String(row[firstCol] == null ? '' : row[firstCol]).trim() : '';
      const name = (first + ' ' + surname).trim();
      if (!name) continue;
      if (normKey(name) === 'surname') continue;
      const marks = {};
      for (const a of assignments) {
        for (let j = 0; j < a.cols.length; j += 1) {
          marks[a.name + '|' + a.criteria[j]] = isComplete(row[a.cols[j]]);
        }
      }
      students.push({ name, marks });
    }

    units.push({
      name: unitName,
      tab: sheet.name,
      assignments: assignments.map((a) => ({ name: a.name, criteria: a.criteria })),
      students,
    });
  }

  return { units, skipped };
}

module.exports = { parseImport, parseWorkbook, isComplete };

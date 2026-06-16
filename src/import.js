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
  // Accepts plain (P1) or assignment-prefixed (A.P2, B.M1) criterion codes.
  return /^(?:[A-Za-z]\s*[.\-]\s*)?[PMD]\d+$/i.test(String(value == null ? '' : value).trim());
}

function extractCode(value) {
  const m = String(value == null ? '' : value).trim().match(/([PMD]\d+)\s*$/i);
  return m ? m[1].toUpperCase() : '';
}

function cell(rows, r, c) {
  const row = rows[r];
  if (!row) return '';
  return String(row[c] == null ? '' : row[c]).trim();
}

// "U1 A123" -> "Unit 1", "Unit 8" -> "Unit 8". Null if no unit number found.
function unitNameFromTab(tab) {
  const m = String(tab || '').match(/u(?:nit)?\s*0*([0-9]+)/i);
  return m ? 'Unit ' + m[1] : null;
}

function findHeaderRowIdx(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const lc = rows[i].map((c) => String(c == null ? '' : c).trim().toLowerCase());
    if (lc.includes('surname') || lc.includes('students') || lc.includes('student')) return i;
    if (rows[i].filter(isCode).length >= 3) return i;
  }
  return -1;
}

// Does a column below the header look like criterion marks (y / n / r / u)?
function columnIsMarks(rows, h, c) {
  let marks = 0;
  let total = 0;
  for (let r = h + 1; r < rows.length; r += 1) {
    const v = cell(rows, r, c).toLowerCase();
    if (!v) continue;
    total += 1;
    if (v === 'y' || v === 'n' || v === 'r' || v === 'u') marks += 1;
  }
  return total > 0 && marks / total >= 0.6;
}

// Does a column look like student-number IDs (e.g. SC243208)?
function columnLooksLikeIds(rows, h, c) {
  let ids = 0;
  let total = 0;
  for (let r = h + 1; r < rows.length; r += 1) {
    const v = cell(rows, r, c);
    if (!v) continue;
    total += 1;
    if (/^[A-Za-z]{0,5}\d{3,}$/.test(v)) ids += 1;
  }
  return total > 0 && ids / total >= 0.5;
}

const MARK_VALUES = new Set(['y', 'n', 'r', 'u']);

function valueIsName(v) {
  // A student ID like "SC255597" contains letters but is not a name.
  if (/^[A-Za-z]{1,4}\d{3,}$/.test(v)) return false;
  return /[A-Za-z]{2,}/.test(v) && !MARK_VALUES.has(v.toLowerCase()) && !/^\d+$/.test(v);
}

// Does a column hold actual names (not marks/numbers/blanks)? Requires the
// column to be reasonably populated so a sparse ID column isn't mistaken for one.
function columnIsNames(rows, h, c) {
  if (c < 0) return false;
  let names = 0;
  let total = 0;
  for (let r = h + 1; r < rows.length; r += 1) {
    const v = cell(rows, r, c);
    if (!v) continue;
    total += 1;
    if (valueIsName(v)) names += 1;
  }
  return total >= 3 && names / total >= 0.5;
}

// Locate the student-number, first-name and surname columns. Returns null if the
// name columns can't be identified reliably, so the tab is skipped rather than
// producing garbage records from inconsistent layouts.
function locateNameColumns(rows, h) {
  const header = rows[h];
  let numberCol = -1;
  let firstHdr = -1;
  let surnameHdr = -1;
  header.forEach((raw, c) => {
    const k = String(raw == null ? '' : raw).trim().toLowerCase();
    if (numberCol < 0 && (/(student|candidate).*(no\b|no\.|number)/.test(k) || /^(uln|reg\.?\s*no)/.test(k))) numberCol = c;
    if (firstHdr < 0 && /^(students?|first\s*name|forename|name)$/.test(k)) firstHdr = c;
    if (surnameHdr < 0 && /^(surname|last\s*name|family\s*name)$/.test(k)) surnameHdr = c;
  });

  let firstCol = -1;
  let surnameCol = -1;
  if (surnameHdr >= 0) {
    surnameCol = surnameHdr;
    firstCol = firstHdr >= 0 ? firstHdr : surnameHdr - 1;
  } else if (firstHdr >= 0) {
    firstCol = firstHdr;
    surnameCol = firstHdr + 1;
  } else {
    // No name headers: take the first two adjacent columns that hold names.
    for (let c = 0; c < Math.min(header.length, 6) - 1; c += 1) {
      if (columnIsNames(rows, h, c) && columnIsNames(rows, h, c + 1)) {
        firstCol = c;
        surnameCol = c + 1;
        break;
      }
    }
  }

  if (numberCol < 0 && firstCol > 0) {
    const probe = firstCol - 1;
    if (probe !== surnameCol && columnLooksLikeIds(rows, h, probe)) numberCol = probe;
  }

  if (!columnIsNames(rows, h, firstCol) || !columnIsNames(rows, h, surnameCol)) return null;
  return { numberCol, firstCol, surnameCol };
}

// Build the ordered criterion columns. Codes come from the header; an
// unlabelled mark column sitting immediately before a known code (the common
// "P1/P3 header cell left blank" quirk) is inferred as that code minus one.
function criterionColumns(rows, h, surnameCol) {
  const header = rows[h];
  const coded = [];
  for (let c = surnameCol + 1; c < header.length; c += 1) {
    if (isCode(header[c])) coded.push({ col: c, code: extractCode(header[c]), inferred: false });
  }
  if (coded.length === 0) return [];

  const usedCols = new Set(coded.map((c) => c.col));
  const presentCodes = new Set(coded.map((c) => c.code));
  const inferred = [];
  for (const cc of coded) {
    const m = cc.code.match(/^([PMD])(\d+)$/);
    if (!m) continue;
    const prev = cc.col - 1;
    const num = parseInt(m[2], 10) - 1;
    const code = m[1] + num;
    if (prev <= surnameCol || num < 1) continue;
    if (usedCols.has(prev) || presentCodes.has(code)) continue;
    if (!columnIsMarks(rows, h, prev)) continue;
    inferred.push({ col: prev, code, inferred: true });
    usedCols.add(prev);
    presentCodes.add(code);
  }
  return coded.concat(inferred).sort((a, b) => a.col - b.col);
}

// Group adjacent criterion columns into assignments (A1, A2, ...). A gap of up
// to one blank column is tolerated so criteria spread over merged 2-column cells
// stay in one assignment; a wider gap (a grade/points column) starts the next.
// Only used when a brand-new unit is created; existing units keep their structure.
function groupAssignments(critCols) {
  const groups = [];
  let cur = null;
  for (const cc of critCols) {
    if (cur && cc.col - cur.lastCol <= 2) {
      cur.codes.push(cc.code);
      cur.lastCol = cc.col;
    } else {
      cur = { codes: [cc.code], lastCol: cc.col };
      groups.push(cur);
    }
  }
  return groups.map((g, i) => ({ name: 'A' + (i + 1), criteria: g.codes }));
}

function columnIsEmpty(rows, c) {
  for (let r = 0; r < rows.length; r += 1) {
    if (cell(rows, r, c) !== '') return false;
  }
  return true;
}

// For tabs whose criteria headers aren't P/M/D codes (e.g. numeric), use a
// teacher-supplied ordered code list. Detect the name columns and the run of
// mark columns from the data, then map the codes onto the mark columns (1:1, or
// in pairs if criteria span two columns each). No header row required.
function parseOverrideTab(sheet, unitName, codes) {
  const rows = sheet.rows || [];
  // Data-driven name columns (scan from row 0 since the header is unreliable).
  let firstCol = -1;
  let surnameCol = -1;
  for (let c = 0; c < 8; c += 1) {
    if (columnIsNames(rows, -1, c) && columnIsNames(rows, -1, c + 1)) {
      firstCol = c;
      surnameCol = c + 1;
      break;
    }
  }
  if (firstCol < 0) return { skip: { name: sheet.name, reason: 'override set, but no name columns found' } };
  let numberCol = -1;
  if (firstCol > 0 && columnLooksLikeIds(rows, -1, firstCol - 1)) numberCol = firstCol - 1;

  // Collect the criterion (mark) columns after the surname, skipping any grade
  // or points columns interspersed between them, and stopping at the trailing
  // summary block (several consecutive non-mark columns).
  const maxCol = rows.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const markCols = [];
  let gap = 0;
  for (let c = surnameCol + 1; c < maxCol; c += 1) {
    if (columnIsMarks(rows, -1, c)) {
      markCols.push(c);
      gap = 0;
    } else if (columnIsEmpty(rows, c)) {
      // merge gap or blank spacer — neither counts towards the stop threshold
    } else {
      gap += 1; // a grade/points column
      if (markCols.length > 0 && gap >= 4) break;
    }
  }

  let groups;
  if (markCols.length === codes.length) groups = markCols.map((c) => [c]);
  else if (markCols.length === codes.length * 2) {
    groups = [];
    for (let i = 0; i < markCols.length; i += 2) groups.push([markCols[i], markCols[i + 1]]);
  } else {
    return { skip: { name: sheet.name, reason: `override has ${codes.length} codes but found ${markCols.length} mark columns` } };
  }

  const students = [];
  for (let r = 0; r < rows.length; r += 1) {
    const first = cell(rows, r, firstCol);
    const last = cell(rows, r, surnameCol);
    if (!valueIsName(first)) continue;
    const rawNumber = numberCol >= 0 ? cell(rows, r, numberCol) : '';
    const studentNumber = /\d/.test(rawNumber) ? rawNumber : '';
    const marks = {};
    groups.forEach((cols, i) => {
      const vals = cols.map((c) => cell(rows, r, c)).filter((v) => v !== '');
      marks[codes[i]] = vals.length > 0 && vals.every((v) => isComplete(v));
    });
    students.push({ studentNumber, firstName: first, lastName: last, name: (first + ' ' + last).trim(), marks });
  }

  return {
    unit: {
      name: unitName,
      tab: sheet.name,
      assignments: [{ name: 'A1', criteria: codes.slice() }],
      inferredCodes: [],
      skippedRows: 0,
      overrideUsed: true,
      students,
    },
  };
}

// Parse criterion-level tabs into an import payload:
//   units: [{ name, tab, assignments:[{name,criteria}], inferredCodes:[...],
//             students:[{ studentNumber, firstName, lastName, name, marks:{CODE:bool} }] }]
//   skipped: [{ name, reason }]
function parseWorkbook(sheets, options = {}) {
  const units = [];
  const skipped = [];
  // overrides: { normalisedUnitName: [codes...] } for tabs lacking P/M/D headers.
  const overrides = {};
  for (const [name, codes] of Object.entries(options.overrides || {})) {
    overrides[normKey(name)] = Array.isArray(codes) ? codes : String(codes).split(/[\s,]+/).filter(Boolean);
  }

  for (const sheet of sheets) {
    const unitName = unitNameFromTab(sheet.name);
    if (!unitName) {
      skipped.push({ name: sheet.name, reason: 'not a unit tab' });
      continue;
    }

    const override = overrides[normKey(unitName)];
    const rows = sheet.rows || [];
    const h = findHeaderRowIdx(rows);
    const cols = h >= 0 ? locateNameColumns(rows, h) : null;
    const critCols = h >= 0 && cols ? criterionColumns(rows, h, cols.surnameCol) : [];

    // Header codes win. Only fall back to a manual override when the header has
    // no usable P/M/D codes (e.g. a purely numeric tab).
    if (critCols.length === 0) {
      if (override && override.length) {
        const res = parseOverrideTab(sheet, unitName, override.map((c) => c.toUpperCase()));
        if (res.unit) units.push(res.unit);
        else skipped.push(res.skip);
      } else {
        const reason = h < 0
          ? 'no header row found'
          : (!cols ? 'could not identify name columns (inconsistent layout)'
            : 'no P/M/D criteria columns (summary or numeric headers)');
        skipped.push({ name: sheet.name, reason });
      }
      continue;
    }
    const { numberCol, firstCol, surnameCol } = cols;

    const inferredCodes = critCols.filter((c) => c.inferred).map((c) => c.code);
    const assignments = groupAssignments(critCols);

    const students = [];
    let skippedRows = 0;
    for (let r = h + 1; r < rows.length; r += 1) {
      const first = firstCol >= 0 ? cell(rows, r, firstCol) : '';
      const last = surnameCol >= 0 ? cell(rows, r, surnameCol) : '';
      if (normKey(first) === 'students' || normKey(last) === 'surname') continue;
      // Need a real first name; skip misaligned/blank rows rather than guess.
      if (!valueIsName(first)) {
        if (last) skippedRows += 1;
        continue;
      }
      const name = (first + ' ' + last).trim();
      const rawNumber = numberCol >= 0 ? cell(rows, r, numberCol) : '';
      const studentNumber = /\d/.test(rawNumber) ? rawNumber : ''; // ignore "Withdrawn" etc.
      const marks = {};
      for (const cc of critCols) marks[cc.code] = isComplete(cell(rows, r, cc.col));
      students.push({ studentNumber, firstName: first, lastName: last, name, marks });
    }

    units.push({
      name: unitName,
      tab: sheet.name,
      assignments,
      inferredCodes,
      skippedRows,
      students,
    });
  }

  return { units, skipped };
}

module.exports = { parseImport, parseWorkbook, isComplete };

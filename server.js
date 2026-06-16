'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const store = require('./src/store');
const csv = require('./src/csv');
const { parseImport, parseWorkbook } = require('./src/import');
const { readWorkbook } = require('./src/xlsx');
const sync = require('./src/sync');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Ordered list of every criterion with its CSV column label "<Unit> | <code>".
function criterionColumns() {
  const cols = [];
  for (const unit of store.buildTree()) {
    for (const assignment of unit.assignments) {
      for (const c of assignment.criteria) {
        cols.push({ id: c.id, label: `${unit.name} | ${c.code}` });
      }
    }
  }
  return cols;
}

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(16).toString('hex');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));
app.use('/static', express.static(path.join(__dirname, 'public')));

// Make the absolute base URL available so we can build shareable student links.
app.use((req, res, next) => {
  res.locals.baseUrl = `${req.protocol}://${req.get('host')}`;
  res.locals.title = store.getSettings().title;
  res.locals.publicLabel = store.publicLabel;
  res.locals.fullName = store.fullName;
  res.locals.examUnits = store.examUnits();
  res.locals.examInfo = store.getExamInfo();
  next();
});

// ---- Admin auth -------------------------------------------------------------

function isAdmin(req) {
  return req.signedCookies && req.signedCookies.admin === 'yes';
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.redirect('/admin/login');
}

app.get('/admin/login', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin');
  res.render('login', { error: null });
});

app.post('/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('admin', 'yes', {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.redirect('/admin');
  }
  res.status(401).render('login', { error: 'Incorrect password.' });
});

app.post('/admin/logout', (req, res) => {
  res.clearCookie('admin');
  res.redirect('/admin/login');
});

// ---- Public landing ---------------------------------------------------------

app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ---- Admin: dashboard -------------------------------------------------------

app.get('/admin', requireAdmin, (req, res) => {
  const students = store.studentsOrdered().map((s) => ({
    ...s,
    summary: store.progressSummary(s.id),
  }));
  const tree = store.buildTree();
  const totalCriteria = store.allCriteria().length;
  res.render('dashboard', {
    students,
    tree,
    totalCriteria,
    unverifiedCount: students.filter((s) => !(s.studentNumber && String(s.studentNumber).trim())).length,
    syncConfigured: sync.isConfigured(),
    syncSource: sync.sourceLabel(),
  });
});

// ---- Admin: students --------------------------------------------------------

app.post('/admin/students', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) store.addStudent(name);
  res.redirect('/admin');
});

app.post('/admin/students/:id/rename', requireAdmin, (req, res) => {
  store.updateStudentDetails(req.params.id, {
    name: req.body.name,
    studentNumber: req.body.studentNumber,
  });
  res.redirect('/admin/students/' + req.params.id);
});

// Remove students with no verified student number (and any "Withdrawn").
app.post('/admin/remove-unverified', requireAdmin, (req, res) => {
  store.removeStudentsWithoutNumber();
  res.redirect('/admin');
});

// Danger zone: wipe everything so the teacher can re-import from scratch.
app.post('/admin/reset', requireAdmin, (req, res) => {
  if ((req.body.confirm || '').trim().toUpperCase() === 'DELETE') store.resetAll();
  res.redirect('/admin');
});

app.post('/admin/students/:id/regenerate', requireAdmin, (req, res) => {
  store.regenerateToken(req.params.id);
  res.redirect('/admin/students/' + req.params.id);
});

app.post('/admin/students/:id/delete', requireAdmin, (req, res) => {
  store.deleteStudent(req.params.id);
  res.redirect('/admin');
});

app.get('/admin/students/:id', requireAdmin, (req, res) => {
  const student = store.getStudent(req.params.id);
  if (!student) return res.status(404).render('notfound');
  const tree = store.buildTree().map((unit) => {
    const assignments = unit.assignments.map((a) => ({
      ...a,
      criteria: a.criteria.map((c) => ({ ...c, complete: store.isComplete(student.id, c.id) })),
    }));
    const grade = store.gradeForCriteria(assignments.flatMap((a) => a.criteria));
    return { ...unit, assignments, grade };
  });
  res.render('student_admin', {
    student,
    tree,
    summary: store.progressSummary(student.id),
  });
});

// Toggle a single criterion for a student (called from the admin grid via fetch).
app.post('/admin/progress', requireAdmin, (req, res) => {
  const { studentId, criterionId, complete } = req.body;
  if (!studentId || !criterionId) return res.status(400).json({ ok: false });
  store.setProgress(studentId, criterionId, !!complete);
  const unitId = store.unitIdForCriterion(criterionId);
  const grade = unitId ? store.gradeForUnit(studentId, unitId) : null;
  res.json({ ok: true, summary: store.progressSummary(studentId), unitId, grade });
});

// ---- Admin: CSV export / import ---------------------------------------------

// Download the current data as CSV. This file IS the import template: edit it
// (mark cells x / blank) and upload it back. Doubles as a simple backup.
app.get('/admin/export.csv', requireAdmin, (req, res) => {
  const cols = criterionColumns();
  const rows = [['Student', ...cols.map((c) => c.label)]];
  for (const s of store.studentsOrdered()) {
    rows.push([s.name, ...cols.map((c) => (store.isComplete(s.id, c.id) ? 'x' : ''))]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gradetracker.csv"');
  res.send(csv.stringify(rows));
});

app.post('/admin/import', requireAdmin, (req, res) => {
  const rows = csv.parse(req.body.csv || '');
  if (rows.length < 2) {
    return res.status(400).render('import_result', {
      error: 'No data found. The file needs a header row plus at least one student row.',
      result: null,
      parsed: null,
    });
  }

  const parsed = parseImport(rows, store.buildTree());
  if (parsed.matchedColumns === 0) {
    return res.status(400).render('import_result', {
      error: "Couldn't match any criteria columns. Check the sheet has a 'Students' "
        + 'header row with criteria codes (e.g. P1, P2) and a unit title above it, '
        + 'or use the downloaded template.',
      result: null,
      parsed,
    });
  }

  const result = store.applyImport(parsed.records);
  res.render('import_result', { error: null, result, parsed });
});

// Upload a whole .xlsx workbook. Reads every criterion-level tab, builds the
// units/criteria from the sheet, and imports student progress.
app.post('/admin/import-xlsx', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).render('import_workbook_result', {
      error: 'No file received. Choose an .xlsx file and try again.',
      result: null,
      payload: null,
    });
  }
  let sheets;
  try {
    sheets = readWorkbook(req.file.buffer);
  } catch (err) {
    return res.status(400).render('import_workbook_result', {
      error: "Couldn't read that file as an .xlsx workbook (" + err.message + ').',
      result: null,
      payload: null,
    });
  }
  const payload = parseWorkbook(sheets, { overrides: store.getTabCodes() });
  if (payload.units.length === 0) {
    return res.status(400).render('import_workbook_result', {
      error: 'No criterion-level tabs found. Tabs need a unit name (e.g. "Unit 8" '
        + 'or "U1 ...") and a row with criteria codes (P1, P2, ...).',
      result: null,
      payload,
    });
  }
  const result = store.importWorkbook(payload);
  res.render('import_workbook_result', { error: null, result, payload });
});

// Pull the latest workbook from the configured cloud source and re-import it.
app.post('/admin/sync', requireAdmin, async (req, res) => {
  if (!sync.isConfigured()) {
    return res.status(400).render('import_workbook_result', {
      error: 'Cloud sync is not configured yet. See the "Cloud sync" section of the README to set it up.',
      result: null,
      payload: null,
    });
  }
  try {
    const buffer = await sync.fetchWorkbook();
    const sheets = readWorkbook(buffer);
    const payload = parseWorkbook(sheets, { overrides: store.getTabCodes() });
    if (payload.units.length === 0) {
      return res.status(400).render('import_workbook_result', {
        error: 'Synced the file, but found no criterion-level tabs to import.',
        result: null,
        payload,
      });
    }
    const result = store.importWorkbook(payload);
    res.render('import_workbook_result', { error: null, result, payload });
  } catch (err) {
    res.status(502).render('import_workbook_result', {
      error: 'Sync failed: ' + err.message,
      result: null,
      payload: null,
    });
  }
});

// ---- Admin: units / assignments / criteria ----------------------------------

app.get('/admin/units', requireAdmin, (req, res) => {
  res.render('units_admin', { tree: store.buildTree(), tabCodes: store.getTabCodes() });
});

// Criteria-code override for a tab whose headers aren't P/M/D codes.
app.post('/admin/tab-codes', requireAdmin, (req, res) => {
  store.setTabCode(req.body.unit, req.body.codes);
  res.redirect('/admin/units');
});

app.post('/admin/tab-codes/delete', requireAdmin, (req, res) => {
  store.deleteTabCode(req.body.unit);
  res.redirect('/admin/units');
});

app.post('/admin/units', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) store.addUnit(name);
  res.redirect('/admin/units');
});

app.post('/admin/units/:id/rename', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) store.renameUnit(req.params.id, name);
  res.redirect('/admin/units');
});

app.post('/admin/units/:id/delete', requireAdmin, (req, res) => {
  store.deleteUnit(req.params.id);
  res.redirect('/admin/units');
});

app.post('/admin/units/:id/assignments', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) store.addAssignment(req.params.id, name);
  res.redirect('/admin/units');
});

app.post('/admin/assignments/:id/rename', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) store.renameAssignment(req.params.id, name);
  res.redirect('/admin/units');
});

app.post('/admin/assignments/:id/delete', requireAdmin, (req, res) => {
  store.deleteAssignment(req.params.id);
  res.redirect('/admin/units');
});

app.post('/admin/assignments/:id/criteria', requireAdmin, (req, res) => {
  // Accept several codes at once, e.g. "P1 P2 M1" or "P1, P2".
  const raw = (req.body.code || '').trim();
  const codes = raw.split(/[\s,]+/).filter(Boolean);
  for (const code of codes) store.addCriterion(req.params.id, code);
  res.redirect('/admin/units');
});

app.post('/admin/criteria/:id/delete', requireAdmin, (req, res) => {
  store.deleteCriterion(req.params.id);
  res.redirect('/admin/units');
});

// ---- Admin: backups ---------------------------------------------------------

app.get('/admin/backups', requireAdmin, (req, res) => {
  res.render('backups', { backups: store.listBackups(), error: null, message: null });
});

// Download the current data as a self-contained JSON backup (decrypted).
app.get('/admin/backup', requireAdmin, (req, res) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="gradetracker-backup-${stamp}.json"`);
  res.send(JSON.stringify(store.exportData(), null, 2));
});

// Restore from an uploaded backup file (replaces all data).
app.post('/admin/restore', requireAdmin, upload.single('file'), (req, res) => {
  try {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) throw new Error('No file received.');
    store.restoreData(store.parseBackup(req.file.buffer.toString('utf8')));
    res.render('backups', { backups: store.listBackups(), error: null, message: 'Data restored from the uploaded file.' });
  } catch (err) {
    res.status(400).render('backups', { backups: store.listBackups(), error: 'Restore failed: ' + err.message, message: null });
  }
});

// Roll back to an automatic snapshot.
app.post('/admin/restore-snapshot', requireAdmin, (req, res) => {
  try {
    store.restoreFromBackupFile(req.body.file || '');
    res.render('backups', { backups: store.listBackups(), error: null, message: 'Rolled back to ' + (req.body.file || '') + '.' });
  } catch (err) {
    res.status(400).render('backups', { backups: store.listBackups(), error: 'Rollback failed: ' + err.message, message: null });
  }
});

// ---- Admin: class overview --------------------------------------------------

app.get('/admin/overview', requireAdmin, (req, res) => {
  const unitNum = (name) => {
    const m = String(name).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 999;
  };
  const units = store.buildTree()
    .filter((u) => !u.exam)
    .map((u) => ({ id: u.id, name: u.name, num: unitNum(u.name), year: u.year }))
    .sort((a, b) => a.year - b.year || a.num - b.num);
  const exams = store.examUnits();

  const students = store.studentsOrdered().map((s) => ({
    id: s.id,
    label: store.publicLabel(s),
    summary: store.progressSummary(s.id),
    grades: units.map((u) => store.gradeForUnit(s.id, u.id)),
  }));

  // Per-unit grade distribution for the footer row.
  const totals = units.map((u, i) => {
    const c = { D: 0, M: 0, P: 0, U: 0, none: 0 };
    for (const s of students) {
      const g = s.grades[i].grade;
      if (!g) c.none += 1;
      else c[g] += 1;
    }
    return c;
  });

  res.render('overview', { units, exams, students, totals });
});

// ---- Student read-only view -------------------------------------------------

app.get('/s/:token', (req, res) => {
  const student = store.getStudentByToken(req.params.token);
  if (!student) return res.status(404).render('notfound');

  const tree = store.buildTree().map((unit) => {
    const assignments = unit.assignments.map((a) => {
      const criteria = a.criteria.map((c) => ({ ...c, complete: store.isComplete(student.id, c.id) }));
      const outstanding = criteria.filter((c) => !c.complete);
      return { ...a, criteria, outstanding };
    });
    const unitOutstanding = assignments.flatMap((a) => a.outstanding);
    const grade = store.gradeForCriteria(assignments.flatMap((a) => a.criteria));
    return { ...unit, assignments, unitOutstanding, grade };
  });

  res.render('student_view', {
    student,
    tree,
    summary: store.progressSummary(student.id),
  });
});

app.use((req, res) => {
  res.status(404).render('notfound');
});

app.listen(PORT, () => {
  console.log(`GradeTracker running on http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD === 'changeme' ? "'changeme' (set ADMIN_PASSWORD to change)" : '(set via ADMIN_PASSWORD)'}`);
  console.log(`Data at rest: ${process.env.ENCRYPTION_KEY ? 'encrypted (AES-256-GCM)' : 'NOT encrypted (set ENCRYPTION_KEY to enable)'}`);
});

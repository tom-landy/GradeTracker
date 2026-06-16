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
  res.render('dashboard', { students, tree, totalCriteria });
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
  const payload = parseWorkbook(sheets);
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

// ---- Admin: units / assignments / criteria ----------------------------------

app.get('/admin/units', requireAdmin, (req, res) => {
  res.render('units_admin', { tree: store.buildTree() });
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
});

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { seedData } = require('./seed');

// DATA_DIR can point at a persistent disk in production (e.g. a mounted volume).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function studentToken() {
  return crypto.randomBytes(12).toString('hex');
}

// Pass / Merit / Distinction inferred from the criterion code (P1, M2, D3...).
function criterionType(code) {
  const letter = String(code || '').trim().charAt(0).toUpperCase();
  if (letter === 'P') return 'Pass';
  if (letter === 'M') return 'Merit';
  if (letter === 'D') return 'Distinction';
  return 'Other';
}

let db = null;

function emptyDb() {
  return {
    units: [],
    assignments: [],
    criteria: [],
    students: [],
    // progress[studentId][criterionId] === true means completed
    progress: {},
    settings: { title: 'Year 1 outstanding work break down' },
  };
}

function load() {
  if (db) return db;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    db = JSON.parse(raw);
    // Make sure every collection exists even if the file is from an older version.
    const base = emptyDb();
    for (const key of Object.keys(base)) {
      if (db[key] === undefined) db[key] = base[key];
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    db = emptyDb();
    seed(db);
    save();
  }
  return db;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH); // atomic-ish write so we never leave a half file
}

function seed(target) {
  for (const unit of seedData) {
    const unitId = id();
    target.units.push({ id: unitId, name: unit.name, position: target.units.length });
    for (const assignment of unit.assignments) {
      const assignmentId = id();
      target.assignments.push({
        id: assignmentId,
        unitId,
        name: assignment.name,
        position: target.assignments.filter((a) => a.unitId === unitId).length,
      });
      for (const code of assignment.criteria) {
        target.criteria.push({
          id: id(),
          assignmentId,
          code,
          position: target.criteria.filter((c) => c.assignmentId === assignmentId).length,
        });
      }
    }
  }
}

// ---- Queries ----------------------------------------------------------------

function getSettings() {
  return load().settings;
}

function unitsOrdered() {
  return [...load().units].sort((a, b) => a.position - b.position);
}

function assignmentsForUnit(unitId) {
  return load()
    .assignments.filter((a) => a.unitId === unitId)
    .sort((a, b) => a.position - b.position);
}

function criteriaForAssignment(assignmentId) {
  return load()
    .criteria.filter((c) => c.assignmentId === assignmentId)
    .sort((a, b) => a.position - b.position);
}

function allCriteria() {
  return load().criteria;
}

// A nested structure that mirrors the printed breakdown: unit -> assignments -> criteria.
function buildTree() {
  return unitsOrdered().map((unit) => ({
    ...unit,
    assignments: assignmentsForUnit(unit.id).map((assignment) => ({
      ...assignment,
      criteria: criteriaForAssignment(assignment.id).map((c) => ({
        ...c,
        type: criterionType(c.code),
      })),
    })),
  }));
}

function studentsOrdered() {
  return [...load().students].sort((a, b) => a.name.localeCompare(b.name));
}

function getStudent(studentId) {
  return load().students.find((s) => s.id === studentId) || null;
}

function getStudentByToken(token) {
  return load().students.find((s) => s.token === token) || null;
}

function isComplete(studentId, criterionId) {
  const p = load().progress[studentId];
  return !!(p && p[criterionId]);
}

// Completed / total counts for a student across every criterion that exists.
function progressSummary(studentId) {
  const criteria = allCriteria();
  const total = criteria.length;
  let done = 0;
  for (const c of criteria) {
    if (isComplete(studentId, c.id)) done += 1;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// ---- Mutations --------------------------------------------------------------

function addUnit(name) {
  load();
  const unit = { id: id(), name: name.trim(), position: db.units.length };
  db.units.push(unit);
  save();
  return unit;
}

function renameUnit(unitId, name) {
  load();
  const unit = db.units.find((u) => u.id === unitId);
  if (unit) {
    unit.name = name.trim();
    save();
  }
}

function deleteUnit(unitId) {
  load();
  const assignmentIds = db.assignments.filter((a) => a.unitId === unitId).map((a) => a.id);
  const criterionIds = db.criteria.filter((c) => assignmentIds.includes(c.assignmentId)).map((c) => c.id);
  db.units = db.units.filter((u) => u.id !== unitId);
  db.assignments = db.assignments.filter((a) => a.unitId !== unitId);
  db.criteria = db.criteria.filter((c) => !assignmentIds.includes(c.assignmentId));
  removeProgressForCriteria(criterionIds);
  save();
}

function addAssignment(unitId, name) {
  load();
  const assignment = {
    id: id(),
    unitId,
    name: name.trim(),
    position: db.assignments.filter((a) => a.unitId === unitId).length,
  };
  db.assignments.push(assignment);
  save();
  return assignment;
}

function renameAssignment(assignmentId, name) {
  load();
  const assignment = db.assignments.find((a) => a.id === assignmentId);
  if (assignment) {
    assignment.name = name.trim();
    save();
  }
}

function deleteAssignment(assignmentId) {
  load();
  const criterionIds = db.criteria.filter((c) => c.assignmentId === assignmentId).map((c) => c.id);
  db.assignments = db.assignments.filter((a) => a.id !== assignmentId);
  db.criteria = db.criteria.filter((c) => c.assignmentId !== assignmentId);
  removeProgressForCriteria(criterionIds);
  save();
}

function addCriterion(assignmentId, code) {
  load();
  const criterion = {
    id: id(),
    assignmentId,
    code: code.trim().toUpperCase(),
    position: db.criteria.filter((c) => c.assignmentId === assignmentId).length,
  };
  db.criteria.push(criterion);
  save();
  return criterion;
}

function deleteCriterion(criterionId) {
  load();
  db.criteria = db.criteria.filter((c) => c.id !== criterionId);
  removeProgressForCriteria([criterionId]);
  save();
}

function removeProgressForCriteria(criterionIds) {
  if (!criterionIds.length) return;
  const set = new Set(criterionIds);
  for (const studentId of Object.keys(db.progress)) {
    for (const cid of Object.keys(db.progress[studentId])) {
      if (set.has(cid)) delete db.progress[studentId][cid];
    }
  }
}

function addStudent(name) {
  load();
  const student = {
    id: id(),
    name: name.trim(),
    token: studentToken(),
    createdAt: new Date().toISOString(),
  };
  db.students.push(student);
  db.progress[student.id] = {};
  save();
  return student;
}

function renameStudent(studentId, name) {
  load();
  const student = db.students.find((s) => s.id === studentId);
  if (student) {
    student.name = name.trim();
    save();
  }
}

function regenerateToken(studentId) {
  load();
  const student = db.students.find((s) => s.id === studentId);
  if (student) {
    student.token = studentToken();
    save();
  }
  return student;
}

function deleteStudent(studentId) {
  load();
  db.students = db.students.filter((s) => s.id !== studentId);
  delete db.progress[studentId];
  save();
}

function getStudentByName(name) {
  const wanted = String(name || '').trim().toLowerCase();
  return load().students.find((s) => s.name.trim().toLowerCase() === wanted) || null;
}

// Bulk upsert from a CSV import. Each record:
//   { name, complete: [criterionId...], outstanding: [criterionId...] }
// Students are matched by name (case-insensitive) or created. Only the criteria
// listed in a record are touched; everything else is left as-is. Saves once.
function applyImport(records) {
  load();
  let created = 0;
  let updated = 0;
  let marksComplete = 0;
  let marksOutstanding = 0;
  for (const rec of records) {
    let student = getStudentByName(rec.name);
    if (!student) {
      student = {
        id: id(),
        name: rec.name.trim(),
        token: studentToken(),
        createdAt: new Date().toISOString(),
      };
      db.students.push(student);
      db.progress[student.id] = {};
      created += 1;
    } else {
      updated += 1;
    }
    if (!db.progress[student.id]) db.progress[student.id] = {};
    for (const cid of rec.complete) {
      db.progress[student.id][cid] = true;
      marksComplete += 1;
    }
    for (const cid of rec.outstanding) {
      delete db.progress[student.id][cid];
      marksOutstanding += 1;
    }
  }
  save();
  return { created, updated, marksComplete, marksOutstanding };
}

// Import a parsed workbook payload. Idempotently ensures units, assignments and
// criteria exist (matched by name/code), upserts students by name, and sets
// progress. Saves once. payload.units[].students[].marks is { "A1|P1": bool }.
function importWorkbook(payload) {
  load();
  let unitsCreated = 0;
  let criteriaCreated = 0;
  let marks = 0;
  const seenStudents = new Set();
  let studentsCreated = 0;

  for (const u of payload.units) {
    let unit = db.units.find((x) => x.name.trim().toLowerCase() === u.name.trim().toLowerCase());
    if (!unit) {
      unit = { id: id(), name: u.name.trim(), position: db.units.length };
      db.units.push(unit);
      unitsCreated += 1;
    }
    const keyToCid = {};
    for (const a of u.assignments) {
      let asg = db.assignments.find(
        (x) => x.unitId === unit.id && x.name.trim().toLowerCase() === a.name.trim().toLowerCase()
      );
      if (!asg) {
        asg = {
          id: id(),
          unitId: unit.id,
          name: a.name.trim(),
          position: db.assignments.filter((x) => x.unitId === unit.id).length,
        };
        db.assignments.push(asg);
      }
      for (const code of a.criteria) {
        const upper = code.trim().toUpperCase();
        let crit = db.criteria.find(
          (x) => x.assignmentId === asg.id && x.code.toUpperCase() === upper
        );
        if (!crit) {
          crit = {
            id: id(),
            assignmentId: asg.id,
            code: upper,
            position: db.criteria.filter((x) => x.assignmentId === asg.id).length,
          };
          db.criteria.push(crit);
          criteriaCreated += 1;
        }
        keyToCid[a.name + '|' + upper] = crit.id;
      }
    }

    for (const s of u.students) {
      let student = getStudentByName(s.name);
      if (!student) {
        student = {
          id: id(),
          name: s.name.trim(),
          token: studentToken(),
          createdAt: new Date().toISOString(),
        };
        db.students.push(student);
        db.progress[student.id] = {};
        studentsCreated += 1;
      }
      seenStudents.add(student.id);
      if (!db.progress[student.id]) db.progress[student.id] = {};
      for (const key of Object.keys(s.marks)) {
        const cid = keyToCid[key];
        if (!cid) continue;
        if (s.marks[key]) {
          db.progress[student.id][cid] = true;
          marks += 1;
        } else {
          delete db.progress[student.id][cid];
        }
      }
    }
  }

  save();
  return {
    unitsCreated,
    criteriaCreated,
    studentsCreated,
    studentsTouched: seenStudents.size,
    marks,
  };
}

function setProgress(studentId, criterionId, complete) {
  load();
  if (!db.progress[studentId]) db.progress[studentId] = {};
  if (complete) {
    db.progress[studentId][criterionId] = true;
  } else {
    delete db.progress[studentId][criterionId];
  }
  save();
}

module.exports = {
  criterionType,
  getSettings,
  buildTree,
  unitsOrdered,
  allCriteria,
  studentsOrdered,
  getStudent,
  getStudentByToken,
  getStudentByName,
  applyImport,
  importWorkbook,
  isComplete,
  progressSummary,
  addUnit,
  renameUnit,
  deleteUnit,
  addAssignment,
  renameAssignment,
  deleteAssignment,
  addCriterion,
  deleteCriterion,
  addStudent,
  renameStudent,
  regenerateToken,
  deleteStudent,
  setProgress,
};

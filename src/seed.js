'use strict';

// Starting data taken from the "Year 1 outstanding work break down" sheet.
// Each unit has assignments (A1, A2, ...) and each assignment covers a set of
// Pass / Merit / Distinction criteria. All of this is editable in the admin area.
// Unit 8's criteria were blank on the original sheet, so its assignments start
// empty (TBD) ready to be filled in.
const seedData = [
  {
    name: 'Unit 1',
    assignments: [
      { name: 'A1', criteria: ['P1', 'P2', 'P3', 'M1', 'M2', 'D1'] },
      { name: 'A2', criteria: ['P4', 'P5', 'P6', 'M3', 'M4', 'D2', 'D3'] },
      { name: 'A3', criteria: ['P7', 'M5', 'D4'] },
    ],
  },
  {
    name: 'Unit 4',
    assignments: [
      { name: 'A1', criteria: ['P1', 'P2', 'M1', 'D1'] },
      { name: 'A2', criteria: ['P4', 'P5', 'P6', 'M3', 'M4', 'D2'] },
      { name: 'A3', criteria: ['P7', 'P8', 'M4', 'M5', 'D3'] },
    ],
  },
  {
    name: 'Unit 8',
    assignments: [
      { name: 'A1', criteria: [] },
      { name: 'A2', criteria: [] },
    ],
  },
  {
    name: 'Unit 9',
    assignments: [
      { name: 'A1', criteria: ['P1', 'P2', 'P3', 'P4', 'M1', 'M2', 'D1', 'D2'] },
      { name: 'A2', criteria: ['P5', 'P6', 'M3', 'D3'] },
    ],
  },
  {
    name: 'Unit 27',
    assignments: [
      { name: 'A1', criteria: ['P1', 'P2', 'M1', 'D1'] },
      { name: 'A2', criteria: ['M2', 'M3', 'D2', 'D3'] },
    ],
  },
];

module.exports = { seedData };

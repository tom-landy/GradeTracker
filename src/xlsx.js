'use strict';

// Minimal .xlsx reader: unzips the workbook and turns each worksheet into a
// 2D array of strings. Good enough for grid-style mark sheets (text + y/n
// values); it does not evaluate formulas or format numbers/dates.

const { unzipSync, strFromU8 } = require('fflate');

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  const out = [];
  if (!xml) return out;
  xml.replace(/<si>([\s\S]*?)<\/si>/g, (m, inner) => {
    let text = '';
    inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, t) => {
      text += t;
      return '';
    });
    out.push(decodeEntities(text));
    return '';
  });
  return out;
}

function colIndex(ref) {
  const letters = ref.match(/^([A-Z]+)/)[1];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowIndex(ref) {
  return parseInt(ref.match(/(\d+)$/)[1], 10) - 1;
}

function parseSheetRows(xml, shared) {
  const cells = []; // { r, c, v }
  let maxRow = -1;
  let maxCol = -1;
  xml.replace(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, attrs, body) => {
    const refMatch = attrs.match(/r="([A-Z]+\d+)"/);
    if (!refMatch) return '';
    const ref = refMatch[1];
    const r = rowIndex(ref);
    const c = colIndex(ref);
    const type = (attrs.match(/t="([^"]+)"/) || [])[1];
    let value = '';
    if (body) {
      if (type === 'inlineStr') {
        let text = '';
        body.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (mm, t) => {
          text += t;
          return '';
        });
        value = decodeEntities(text);
      } else {
        const vm = body.match(/<v>([\s\S]*?)<\/v>/);
        if (vm) {
          if (type === 's') value = shared[parseInt(vm[1], 10)] || '';
          else value = decodeEntities(vm[1]);
        }
      }
    }
    cells.push({ r, c, v: value });
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
    return '';
  });

  const rows = [];
  for (let r = 0; r <= maxRow; r += 1) {
    rows.push(new Array(maxCol + 1).fill(''));
  }
  for (const cell of cells) rows[cell.r][cell.c] = cell.v;
  return rows;
}

// Returns [{ name, rows }] in workbook (tab) order.
function readWorkbook(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const get = (p) => (files[p] ? strFromU8(files[p]) : null);

  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('Not a valid .xlsx workbook.');

  const shared = parseSharedStrings(get('xl/sharedStrings.xml') || '');

  const sheetDefs = [];
  wb.replace(/<sheet\b[^>]*?\/?>/g, (tag) => {
    const name = (tag.match(/name="([^"]*)"/) || [])[1];
    const rid = (tag.match(/r:id="([^"]*)"/) || [])[1];
    if (name && rid) sheetDefs.push({ name, rid });
    return '';
  });

  const ridToTarget = {};
  rels.replace(/<Relationship\b[^>]*?\/?>/g, (tag) => {
    const idm = (tag.match(/Id="([^"]*)"/) || [])[1];
    const tgt = (tag.match(/Target="([^"]*)"/) || [])[1];
    if (idm && tgt) ridToTarget[idm] = tgt;
    return '';
  });

  const sheets = [];
  for (const sd of sheetDefs) {
    let target = ridToTarget[sd.rid];
    if (!target) continue;
    target = target.replace(/^\//, '');
    if (!target.startsWith('xl/')) target = 'xl/' + target;
    const xml = get(target);
    if (!xml) continue;
    sheets.push({ name: sd.name, rows: parseSheetRows(xml, shared) });
  }
  return sheets;
}

module.exports = { readWorkbook };

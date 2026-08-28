const fs = require('fs');
const path = 'tessa-matrix-studio.user.js';
let s = fs.readFileSync(path, 'utf8');
function once(before, after, label) {
  const n = s.split(before).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 anchor, got ${n}`);
  s = s.replace(before, after);
}

once(
`    if (desiredRows.length === snapshot.rows.length) {
      for (const desired of desiredRows) {
        const identity = excelIdentityKey(desired);
        if (identity) identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
      }
      desiredRows.forEach((desired, index) => expectedCurrentByExcelRow.set(desired, snapshot.rows[index] || null));`,
`    // Новые строки без identity не должны ломать позиционное доказательство REPLACE
    // между исходными identity-строками. Сопоставляем позиции только по baseline-рядам.
    const positionalDesiredRows = desiredRows.filter(desired => desired.system.action !== 'add' && Boolean(excelIdentityKey(desired)));
    const canAlignByPosition = positionalDesiredRows.length === snapshot.rows.length;
    if (canAlignByPosition) {
      for (const desired of positionalDesiredRows) {
        const identity = excelIdentityKey(desired);
        if (identity) identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
      }
      positionalDesiredRows.forEach((desired, index) => expectedCurrentByExcelRow.set(desired, snapshot.rows[index] || null));`,
'schema refresh positional rows');

once(
`    const expectedCurrentByExcelRow = new Map();
    const identityCounts = new Map();
    if (desired.length === snapshot.rows.length) {
      for (const row of desired) {
        const key = excelIdentityKey(row);
        if (key) identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
      }
      desired.forEach((row, index) => expectedCurrentByExcelRow.set(row, snapshot.rows[index] || null));
    }`,
`    const expectedCurrentByExcelRow = new Map();
    const identityCounts = new Map();
    // ADD без baseline identity может находиться в том же Excel, что и REPLACE.
    // Для позиционного доказательства REPLACE исключаем новые строки из baseline-последовательности.
    const positionalDesiredRows = desired.filter(row => row.system.action !== 'add' && Boolean(excelIdentityKey(row)));
    const canAlignByPosition = positionalDesiredRows.length === snapshot.rows.length;
    if (canAlignByPosition) {
      for (const row of positionalDesiredRows) {
        const key = excelIdentityKey(row);
        if (key) identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
      }
      positionalDesiredRows.forEach((row, index) => expectedCurrentByExcelRow.set(row, snapshot.rows[index] || null));
    }`,
'planner positional rows');

once(
`    const positionalOverwriteTargets = new Map();
    const overwriteMatchedBy = new Map();
    if (desired.length === snapshot.rows.length) {`,
`    const positionalOverwriteTargets = new Map();
    const overwriteMatchedBy = new Map();
    if (canAlignByPosition) {`,
'planner overwrite alignment gate');

fs.writeFileSync(path, s);
console.log('REPLACE + ADD alignment patch applied');

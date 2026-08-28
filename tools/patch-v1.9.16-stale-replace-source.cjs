const fs = require('fs');
const path = 'tessa-matrix-studio.user.js';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = s.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, got ${count}`);
  s = s.replace(from, to);
}

replaceOnce(
  "    const freshByVersion = new Map(fresh.rows.map(row => [canonicalValue(row.versionId), row]));\n    const runtimeSkips = [];",
  "    const freshByVersion = new Map(fresh.rows.map(row => [canonicalValue(row.versionId), row]));\n    const freshByCard = new Map(fresh.rows.map(row => [canonicalValue(row.rowCardId), row]));\n    const runtimeSkips = [];",
  'fresh identity maps'
);

replaceOnce(
  "        if (!current) throw new Error(`Строка ${action.currentRow.versionId} исчезла после предпросмотра.`);\n        if (current.fingerprint !== action.expectedFingerprint) throw new Error(`Строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);\n        await hydrateMissingIdsForAction(action, structure, fresh, bridge);",
  "        if (!current) throw new Error(`Строка ${action.currentRow.versionId} исчезла после предпросмотра.`);\n        if (current.fingerprint !== action.expectedFingerprint) throw new Error(`Строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);\n\n        // REPLACE читает данные из source identity Excel, но записывает их в другую target identity.\n        // Target stale-check выше недостаточен: source мог измениться уже после Preview.\n        // Повторно сверяем source непосредственно перед записью, иначе старый снимок source\n        // может быть перенесён в неизменившийся target.\n        if (isOverwriteMatch(action.match)) {\n          const sourceVersionId = canonicalValue(action.excelRow?.system?.versionId || '');\n          const sourceRowCardId = canonicalValue(action.excelRow?.system?.rowCardId || '');\n          const sourceCurrent = (sourceVersionId ? freshByVersion.get(sourceVersionId) : null)\n            || (sourceRowCardId ? freshByCard.get(sourceRowCardId) : null);\n          if (!sourceCurrent) throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} исчезла после предпросмотра.`);\n          const sourceExpectedFingerprint = canonicalValue(action.excelRow?.system?.baseFingerprint || '');\n          const sourceFreshFingerprint = canonicalValue(sourceCurrent.fingerprint || fingerprintFlat(sourceCurrent.flat || {}));\n          if (!sourceExpectedFingerprint || sourceExpectedFingerprint !== sourceFreshFingerprint) {\n            throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);\n          }\n        }\n\n        await hydrateMissingIdsForAction(action, structure, fresh, bridge);",
  'overwrite source preflight check'
);

fs.writeFileSync(path, s);

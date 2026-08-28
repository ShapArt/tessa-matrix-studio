const fs = require('fs');
const path = 'tessa-matrix-studio.user.js';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = s.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, got ${count}`);
  s = s.replace(from, to);
}

replaceOnce(
  "        actions.push({ type: 'add', excelRow: cloned, currentRow: null, changes: [], match: { matchedBy: 'copied-row-auto-add', lowConfidence: false }, expectedFingerprint: null });",
  "        actions.push({\n          type: 'add',\n          excelRow: cloned,\n          currentRow: null,\n          changes: [],\n          match: {\n            matchedBy: 'copied-row-auto-add',\n            lowConfidence: false,\n            sourceIdentity,\n            sourceVersionId: excelRow.system.versionId || '',\n            sourceRowCardId: excelRow.system.rowCardId || '',\n            sourceFingerprint: excelRow.system.baseFingerprint || currentRow.fingerprint || '',\n          },\n          expectedFingerprint: null,\n        });",
  'preserve copied ADD source provenance'
);

replaceOnce(
  "    for (const action of addActions) {\n      try {\n        if (createCapabilityError) throw createCapabilityError;\n        await hydrateMissingIdsForAction(action, structure, fresh, bridge);",
  "    for (const action of addActions) {\n      try {\n        if (createCapabilityError) throw createCapabilityError;\n\n        // copied-row-auto-add создаёт новую identity, но данные пришли из существующей\n        // source-строки. Source мог измениться уже после Preview, поэтому provenance\n        // сохраняется в match и повторно сверяется непосредственно перед CardNew.\n        if (action.match?.matchedBy === 'copied-row-auto-add') {\n          const sourceVersionId = canonicalValue(action.match.sourceVersionId || '');\n          const sourceRowCardId = canonicalValue(action.match.sourceRowCardId || '');\n          const sourceCurrent = (sourceVersionId ? freshByVersion.get(sourceVersionId) : null)\n            || (sourceRowCardId ? freshByCard.get(sourceRowCardId) : null);\n          if (!sourceCurrent) throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} исчезла после предпросмотра.`);\n          const sourceExpectedFingerprint = canonicalValue(action.match.sourceFingerprint || '');\n          const sourceFreshFingerprint = canonicalValue(sourceCurrent.fingerprint || fingerprintFlat(sourceCurrent.flat || {}));\n          if (!sourceExpectedFingerprint || sourceExpectedFingerprint !== sourceFreshFingerprint) {\n            throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);\n          }\n        }\n\n        await hydrateMissingIdsForAction(action, structure, fresh, bridge);",
  'copied ADD source preflight check'
);

fs.writeFileSync(path, s);

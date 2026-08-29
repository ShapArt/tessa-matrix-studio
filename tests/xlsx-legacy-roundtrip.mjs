import fs from 'node:fs';
import vm from 'node:vm';

const rawSource = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const source = rawSource.replace(
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = {',
  'window.__TESSA_MATRIX_SYNC_EXPORTS__ = { makeZip, unzipArrayBuffer,',
);
if (source === rawSource) throw new Error('test instrumentation could not expose ZIP helpers');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const CURRENT = 'TESSA_MATRIX_ROUNDTRIP_V6';
const legacyFormats = [1, 2, 3, 4, 5].map(n => `TESSA_MATRIX_ROUNDTRIP_V${n}`);

const structure = {
  templateId: 'legacy-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(index, suffix, org, person) {
  const flat = { 'criterion:criterion-org': [org], 'function:function-sign': [person] };
  return {
    index,
    rowCardId: `card-${suffix}`,
    versionId: `version-${suffix}`,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-org': [{ id: `org-${suffix}`, display: org }] },
    roles: { 'function-sign': [{ id: `person-${suffix}`, display: person, roleTypeId: 'role-type' }] },
    flat,
  };
}
const snapshot = {
  matrixId: 'legacy-matrix',
  templateId: structure.templateId,
  rows: [
    row(0, 'a', 'Компания А', 'Иванов И.И.'),
    row(1, 'b', 'Компания Б', 'Петров П.П.'),
    row(2, 'c', 'Компания В', 'Сидоров С.С.'),
  ],
};
const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'Legacy QA' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog);
const originalBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const originalEntries = await E.unzipArrayBuffer(originalBuffer);
const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();
const cloneWorkbook = workbook => ({
  ...workbook,
  rows: workbook.rows.map(item => ({ ...item, values: [...item.values], cellMeta: [...(item.cellMeta || [])] })),
  roundtrip: { ...workbook.roundtrip, baselineRows: [...(workbook.roundtrip?.baselineRows || [])] },
});

for (const format of legacyFormats) {
  const entries = new Map(originalEntries);
  let replacements = 0;
  for (const [name, data] of entries) {
    if (!name.endsWith('.xml')) continue;
    const text = decoder.decode(data);
    if (!text.includes(CURRENT)) continue;
    entries.set(name, encoder.encode(text.replaceAll(CURRENT, format)));
    replacements += 1;
  }
  assert(replacements > 0, `${format}: current format marker not found in generated workbook`);
  const legacyBytes = await E.makeZip([...entries.entries()]);
  const legacyBuffer = legacyBytes.buffer.slice(legacyBytes.byteOffset, legacyBytes.byteOffset + legacyBytes.byteLength);
  const workbook = await E.readXlsxArrayBuffer(legacyBuffer, `${format}.xlsx`);
  assert(workbook.roundtrip.enabled === true, `${format}: parser no longer accepts advertised legacy format`);
  assert(workbook.roundtrip.format === format, `${format}: parser returned ${workbook.roundtrip.format}`);

  // Pre-V6 workbooks had no trusted baseline ledger for physical missing-row DELETE.
  // Model that historical shape explicitly even though this synthetic ZIP was derived
  // from a modern export and therefore still contains the V6-only hidden sheet.
  const authenticLegacy = cloneWorkbook(workbook);
  authenticLegacy.roundtrip.baselineRows = [];
  let plan = E.buildPlan(authenticLegacy, structure, snapshot);
  assert(plan.counts.noop === 3 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
    `${format}: untouched legacy workbook must be clean: ${JSON.stringify(plan.counts)}`);

  const physicallyMissing = cloneWorkbook(authenticLegacy);
  physicallyMissing.rows.splice(1, 1);
  plan = E.buildPlan(physicallyMissing, structure, snapshot);
  assert(plan.counts.delete === 0,
    `${format}: missing Excel row must never become implicit DELETE without V6 ledger: ${JSON.stringify(plan.counts)}`);
  assert(plan.counts.update === 0 && plan.counts.add === 0,
    `${format}: removing a row from legacy workbook created unrelated mutations: ${JSON.stringify(plan.counts)}`);
}

// Schema refresh/migration must fail safe for a legacy physical deletion: the missing row
// is restored from current TESSA state, then a newly exported workbook uses current V6.
const v1 = cloneWorkbook(await E.readXlsxArrayBuffer(originalBuffer, 'current.xlsx'));
v1.roundtrip.format = 'TESSA_MATRIX_ROUNDTRIP_V1';
v1.roundtrip.enabled = true;
v1.roundtrip.baselineRows = [];
v1.rows.splice(1, 1);
const migratedSnapshot = E.mergeWorkbookIntoCurrentSnapshot(v1, structure, snapshot).snapshot;
assert(migratedSnapshot.rows.length === 3 && migratedSnapshot.rows.some(item => item.versionId === 'version-b'),
  `legacy schema refresh must restore untrusted missing row instead of deleting it: ${JSON.stringify(migratedSnapshot.rows.map(item => item.versionId))}`);
const migratedBytes = await E.createRoundtripXlsxBytes(structure, migratedSnapshot, info, catalog);
const migratedBuffer = migratedBytes.buffer.slice(migratedBytes.byteOffset, migratedBytes.byteOffset + migratedBytes.byteLength);
const migrated = await E.readXlsxArrayBuffer(migratedBuffer, 'migrated-v6.xlsx');
assert(migrated.roundtrip.format === CURRENT, `legacy refresh must emit current format, got ${migrated.roundtrip.format}`);
assert(migrated.roundtrip.baselineRows?.length === 3, 'migrated V6 workbook must contain a complete baseline ledger');

console.log('TESSA Matrix Studio V1-V5 compatibility/migration regression: OK');

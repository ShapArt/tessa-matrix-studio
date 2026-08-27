import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const code = fs.readFileSync(scriptPath, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

const structure = {
  templateId: 'qa-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function currentRow(index, rowCardId, versionId, orgId, org, personId, person) {
  const flat = {
    'criterion:criterion-org': [org],
    'function:function-sign': [person],
  };
  return {
    index,
    rowCardId,
    versionId,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
    flat,
  };
}

const snapshot = {
  matrixId: 'qa-matrix',
  templateId: 'qa-template',
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    currentRow(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
};

const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'QA Matrix' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const baseline = await E.readXlsxArrayBuffer(buffer, 'qa-roundtrip.xlsx');

let plan = E.buildPlan(baseline, structure, snapshot);
assert(plan.counts.noop === 2 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `clean roundtrip mismatch: ${JSON.stringify(plan.counts)}`);

const cloneWorkbook = workbook => ({
  ...workbook,
  rows: workbook.rows.map(row => ({ excelRow: row.excelRow, values: [...row.values] })),
});
const headerIndex = name => baseline.headers.indexOf(name);
const signerIndex = headerIndex('Подписание');
const signerIdIndex = headerIndex('Подписание__ID');
assert(signerIndex >= 0 && signerIdIndex >= 0, 'signer columns unavailable');

// Ctrl+C/Ctrl+V поверх существующей строки: копируются и скрытые identity источника.
// После небольшой правки содержимого это должно стать UPDATE целевой позиции, а не ADD+DELETE.
const overwrite = cloneWorkbook(baseline);
overwrite.rows[1].values = [...overwrite.rows[0].values];
overwrite.rows[1].values[signerIndex] = baseline.rows[1].values[signerIndex];
overwrite.rows[1].values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
plan = E.buildPlan(overwrite, structure, snapshot);
const replacement = plan.actions.find(action => action.type === 'update');
assert(plan.counts.noop === 1 && plan.counts.update === 1 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `overwrite mismatch: ${JSON.stringify(plan.counts)}`);
assert(replacement?.currentRow?.index === 1 && replacement?.match?.matchedBy === 'position-overwrite',
  'overwrite must update the target identity by position');

// Если источник копии изменился в TESSA после выгрузки, overwrite нельзя применять из старых данных.
// Обычная copy-to-new-row уже защищена baseFingerprint; ЗАМЕНИТЬ должен соблюдать то же правило.
const staleSourceSnapshot = {
  ...snapshot,
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-z', 'Сидоров С.С.'),
    snapshot.rows[1],
  ],
};
plan = E.buildPlan(overwrite, structure, staleSourceSnapshot);
assert(plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0,
  `stale overwrite source must not produce mutation: ${JSON.stringify(plan.counts)} skipped=${JSON.stringify(plan.skippedRows)}`);
assert(plan.skippedRows.some(item => /исходн.*строк|устар|изменил/i.test(item.reason)),
  `stale overwrite source reason is missing: ${JSON.stringify(plan.skippedRows)}`);

// Та же копия в новой строке должна стать ADD.
const add = cloneWorkbook(baseline);
const newRow = { excelRow: baseline.rows.at(-1).excelRow + 1, values: [...baseline.rows[0].values] };
newRow.values[signerIndex] = baseline.rows[1].values[signerIndex];
newRow.values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
add.rows.push(newRow);
plan = E.buildPlan(add, structure, snapshot);
const addition = plan.actions.find(action => action.type === 'add');
assert(plan.counts.noop === 2 && plan.counts.add === 1 && plan.counts.update === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `copy-to-new-row mismatch: ${JSON.stringify(plan.counts)}`);
assert(addition?.match?.matchedBy === 'copied-row-auto-add', 'copy in a new row must be ADD');

// Физическое удаление одной строки из Excel должно остаться DELETE.
const removed = cloneWorkbook(baseline);
removed.rows.splice(1, 1);
plan = E.buildPlan(removed, structure, snapshot);
assert(plan.counts.noop === 1 && plan.counts.delete === 1 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.skip === 0,
  `single delete mismatch: ${JSON.stringify(plan.counts)}`);

// Сортировка Excel не должна ломать распознавание overwrite.
// Сценарий: исходно A/B/C, пользователь сортирует строки как C/A/B,
// затем копирует A поверх B и оставляет у копии исполнителя B.
// Физическая позиция больше не соответствует snapshot-порядку, поэтому planner обязан
// определить пропавшую identity B и обновить именно её, не создавая лишнюю строку.
const sortedSnapshot = {
  matrixId: 'qa-matrix-sorted',
  templateId: 'qa-template',
  rows: [
    currentRow(0, 'card-a3', 'version-a3', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    currentRow(1, 'card-b3', 'version-b3', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
    currentRow(2, 'card-c3', 'version-c3', 'org-c', 'Компания В', 'person-c', 'Сидоров С.С.'),
  ],
};
const sortedInfo = { matrixId: sortedSnapshot.matrixId, TemplateID: sortedSnapshot.templateId, Name: 'QA Sorted Matrix' };
const sortedCatalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, sortedSnapshot);
const sortedBytes = await E.createRoundtripXlsxBytes(structure, sortedSnapshot, sortedInfo, sortedCatalog);
const sortedBuffer = sortedBytes.buffer.slice(sortedBytes.byteOffset, sortedBytes.byteOffset + sortedBytes.byteLength);
const sortedBaseline = await E.readXlsxArrayBuffer(sortedBuffer, 'qa-sorted-roundtrip.xlsx');
const sortedOverwrite = cloneWorkbook(sortedBaseline);
const valuesA = [...sortedBaseline.rows[0].values];
const valuesB = [...sortedBaseline.rows[1].values];
const valuesC = [...sortedBaseline.rows[2].values];
sortedOverwrite.rows[0].values = valuesC;
sortedOverwrite.rows[1].values = valuesA;
sortedOverwrite.rows[2].values = [...valuesA];
sortedOverwrite.rows[2].values[signerIndex] = valuesB[signerIndex];
sortedOverwrite.rows[2].values[signerIdIndex] = valuesB[signerIdIndex];
plan = E.buildPlan(sortedOverwrite, structure, sortedSnapshot);
const sortedReplacement = plan.actions.find(action => action.type === 'update');
assert(plan.counts.noop === 2 && plan.counts.update === 1 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `sorted overwrite mismatch: ${JSON.stringify(plan.counts)} warnings=${JSON.stringify(plan.warnings)} skipped=${JSON.stringify(plan.skippedRows)}`);
assert(sortedReplacement?.currentRow?.index === 1,
  `sorted overwrite must update missing identity B, got ${JSON.stringify(sortedReplacement?.currentRow)}`);

// Обновление Excel-схемы должно переносить тот же sorted overwrite точно так же, как planner.
// Иначе «Обновить Excel-схему» может незаметно перенести значения копии в исходную identity A.
const refreshed = E.mergeWorkbookIntoCurrentSnapshot(sortedOverwrite, structure, sortedSnapshot).snapshot;
assert(refreshed.rows.length === 3, `schema refresh changed row count: ${refreshed.rows.length}`);
const refreshedA = refreshed.rows.find(row => row.versionId === 'version-a3');
const refreshedB = refreshed.rows.find(row => row.versionId === 'version-b3');
const refreshedC = refreshed.rows.find(row => row.versionId === 'version-c3');
assert(refreshedA?.flat?.['criterion:criterion-org']?.[0] === 'Компания А'
  && refreshedA?.flat?.['function:function-sign']?.[0] === 'Иванов И.И.',
  `schema refresh corrupted source A: ${JSON.stringify(refreshedA?.flat)}`);
assert(refreshedB?.flat?.['criterion:criterion-org']?.[0] === 'Компания А'
  && refreshedB?.flat?.['function:function-sign']?.[0] === 'Петров П.П.',
  `schema refresh mapped overwrite to wrong target B: ${JSON.stringify(refreshedB?.flat)}`);
assert(refreshedC?.flat?.['criterion:criterion-org']?.[0] === 'Компания В'
  && refreshedC?.flat?.['function:function-sign']?.[0] === 'Сидоров С.С.',
  `schema refresh corrupted untouched C: ${JSON.stringify(refreshedC?.flat)}`);

console.log('TESSA Matrix Studio planner tests: OK');

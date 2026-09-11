import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ click() {}, style: {}, set href(_) {}, set download(_) {} }) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'inc-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, refSection: 'GchPartners' }],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(i) {
  const flat = { 'criterion:org': [`Орг ${i}`], 'function:sign': [`Сотрудник ${i}`] };
  return {
    index: i, rowCardId: `card-${i}`, versionId: `version-${i}`,
    fingerprint: E.fingerprintFlat(flat), flat,
    values: { org: [{ id: `org-${i}`, display: `Орг ${i}`, kind: 'ReferenceGuid' }] },
    roles: { sign: [{ id: `person-${i}`, display: `Сотрудник ${i}`, roleTypeId: 1 }] },
  };
}
const snapshot = { matrixId: 'inc-matrix', templateId: structure.templateId, rows: [row(1), row(2), row(3)] };
const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'Incremental' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog, { includeActions: true });
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'incremental.xlsx');

let plan = E.buildPlan(workbook, structure, snapshot, info);
assert(plan.counts.noop === 3, JSON.stringify(plan.counts));
assert(plan.incremental?.rowsCompared === 3, JSON.stringify(plan.incremental));
assert(plan.incremental?.rowsFullyValidated === 0, JSON.stringify(plan.incremental));
assert(plan.incremental?.baselineFastPathHits === 3, JSON.stringify(plan.incremental));

const clone = () => ({ ...workbook, rows: workbook.rows.map(r => ({ ...r, values: [...r.values], cellMeta: r.cellMeta ? [...r.cellMeta] : undefined })) });
const signer = workbook.headers.indexOf('Подписание');
const signerId = workbook.headers.indexOf('Подписание__ID');
assert(signer >= 0 && signerId >= 0, 'signer columns missing');

const updated = clone();
updated.rows[1].values[signer] = 'Сотрудник 3';
updated.rows[1].values[signerId] = 'person-3|1';
plan = E.buildPlan(updated, structure, snapshot, info);
assert(plan.counts.update === 1 && plan.counts.noop === 2, JSON.stringify(plan.counts));
assert(plan.incremental?.rowsFullyValidated === 1 && plan.incremental?.baselineFastPathHits === 2, JSON.stringify(plan.incremental));

const added = clone();
const copied = { ...added.rows[0], excelRow: added.rows.at(-1).excelRow + 2, values: [...added.rows[0].values], cellMeta: added.rows[0].cellMeta ? [...added.rows[0].cellMeta] : undefined };
added.rows.push(copied);
plan = E.buildPlan(added, structure, snapshot, info);
assert(plan.counts.add === 1 && plan.counts.noop === 3, JSON.stringify(plan.counts));
assert(plan.incremental?.rowsFullyValidated === 1 && plan.incremental?.baselineFastPathHits === 3, JSON.stringify(plan.incremental));

const removed = clone();
removed.rows.splice(1, 1);
plan = E.buildPlan(removed, structure, snapshot, info);
assert(plan.counts.delete === 1 && plan.counts.noop === 2, JSON.stringify(plan.counts));
assert(plan.incremental?.baselineFastPathHits === 2, JSON.stringify(plan.incremental));

console.log('TESSA Matrix Studio incremental row diff: OK');

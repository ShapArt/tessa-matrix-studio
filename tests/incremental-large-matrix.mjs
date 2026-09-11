import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

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
  templateId: 'inc-large-template',
  conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, refSection: 'GchPartners' }],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
};
function row(i) {
  const org = i % 100;
  const person = i % 300;
  const flat = { 'criterion:org': [`Орг ${org}`], 'function:sign': [`Сотрудник ${person}`] };
  return {
    index: i, rowCardId: `card-${i}`, versionId: `version-${i}`,
    fingerprint: E.fingerprintFlat(flat), flat,
    values: { org: [{ id: `org-${org}`, display: `Орг ${org}`, kind: 'ReferenceGuid' }] },
    roles: { sign: [{ id: `person-${person}`, display: `Сотрудник ${person}`, roleTypeId: 1 }] },
  };
}
const snapshot = { matrixId: 'inc-large-matrix', templateId: structure.templateId, rows: Array.from({ length: 3000 }, (_, i) => row(i)) };
const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'Incremental Large' };
const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog, { includeActions: true });
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'incremental-large.xlsx');

const startClean = performance.now();
let plan = E.buildPlan(workbook, structure, snapshot, info);
const cleanMs = performance.now() - startClean;
assert(plan.counts.noop === 3000 && plan.incremental?.rowsFullyValidated === 0, JSON.stringify({ counts: plan.counts, incremental: plan.incremental }));
assert(plan.incremental?.baselineFastPathHits === 3000, JSON.stringify(plan.incremental));

const changed = { ...workbook, rows: workbook.rows.map(r => ({ ...r, values: [...r.values], cellMeta: r.cellMeta ? [...r.cellMeta] : undefined })) };
const newRow = { ...changed.rows[0], excelRow: changed.rows.at(-1).excelRow + 3, values: [...changed.rows[0].values], cellMeta: changed.rows[0].cellMeta ? [...changed.rows[0].cellMeta] : undefined };
const signer = workbook.headers.indexOf('Подписание');
const signerId = workbook.headers.indexOf('Подписание__ID');
newRow.values[signer] = 'Сотрудник 1';
newRow.values[signerId] = 'person-1|1';
changed.rows.push(newRow);
const startChanged = performance.now();
plan = E.buildPlan(changed, structure, snapshot, info);
const changedMs = performance.now() - startChanged;
assert(plan.counts.noop === 3000 && plan.counts.add === 1, JSON.stringify(plan.counts));
assert(plan.incremental?.rowsFullyValidated === 1, JSON.stringify(plan.incremental));
assert(plan.incremental?.baselineFastPathHits === 3000, JSON.stringify(plan.incremental));
assert(changedMs < 3000, `3000 KEEP + 1 ADD planning took ${changedMs.toFixed(1)}ms`);

console.log(`TESSA Matrix Studio incremental large matrix: OK (clean ${cleanMs.toFixed(1)}ms; changed ${changedMs.toFixed(1)}ms)`);

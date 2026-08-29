import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [] };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const MAX_XLSX_BYTES = 32 * 1024 * 1024;
// This is intentionally a broad regression ceiling, not an SLA. It only catches
// accidental super-linear explosions or hangs on the standard GitHub runner.
const MAX_TOTAL_MS = 60_000;

const structure = {
  templateId: 'load-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function makeSnapshot(size) {
  const rows = Array.from({ length: size }, (_, index) => {
    const flat = {
      'criterion:criterion-org': ['Компания Нагрузка'],
      'function:function-sign': ['Иванов И.И.'],
    };
    return {
      index,
      rowCardId: `card-load-${index}`,
      versionId: `version-load-${index}`,
      fingerprint: E.fingerprintFlat(flat),
      values: { 'criterion-org': [{ id: 'org-load', display: 'Компания Нагрузка' }] },
      roles: { 'function-sign': [{ id: 'person-load', display: 'Иванов И.И.', roleTypeId: 'role-type' }] },
      flat,
    };
  });
  return {
    matrixId: `load-matrix-${size}`,
    templateId: structure.templateId,
    rows,
    criterionIdCache: new Map(),
    roleIdByFunctionCache: new Map(),
    roleIdCache: new Map(),
  };
}

for (const size of [500, 1000, 5000]) {
  const snapshot = makeSnapshot(size);
  const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: `Load ${size}` };
  const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);

  const started = performance.now();
  const exportStarted = performance.now();
  const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog);
  const exportMs = performance.now() - exportStarted;
  assert(bytes.byteLength < MAX_XLSX_BYTES,
    `${size}: generated workbook exceeded the production input ceiling (${bytes.byteLength} >= ${MAX_XLSX_BYTES})`);

  const importStarted = performance.now();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const workbook = await E.readXlsxArrayBuffer(buffer, `load-${size}.xlsx`);
  const importMs = performance.now() - importStarted;

  const planStarted = performance.now();
  const plan = E.buildPlan(workbook, structure, snapshot);
  const planMs = performance.now() - planStarted;
  const totalMs = performance.now() - started;

  assert(workbook.rows.length === size, `${size}: imported ${workbook.rows.length} rows`);
  assert(workbook.roundtrip.format === 'TESSA_MATRIX_ROUNDTRIP_V6',
    `${size}: wrong roundtrip format ${workbook.roundtrip.format}`);
  assert(workbook.roundtrip.baselineRows?.length === size,
    `${size}: baseline ledger has ${workbook.roundtrip.baselineRows?.length || 0} rows`);
  assert(plan.counts.noop === size
    && plan.counts.update === 0
    && plan.counts.add === 0
    && plan.counts.delete === 0
    && plan.counts.skip === 0,
  `${size}: untouched load workbook produced mutations: ${JSON.stringify(plan.counts)}`);
  assert(totalMs < MAX_TOTAL_MS,
    `${size}: roundtrip exceeded broad ${MAX_TOTAL_MS}ms regression ceiling (${Math.round(totalMs)}ms)`);

  console.log(`TESSA Matrix Studio load ${size}: export=${Math.round(exportMs)}ms import=${Math.round(importMs)}ms plan=${Math.round(planMs)}ms total=${Math.round(totalMs)}ms bytes=${bytes.byteLength}`);
}

console.log('TESSA Matrix Studio 500/1000/5000-row roundtrip load regression: OK');

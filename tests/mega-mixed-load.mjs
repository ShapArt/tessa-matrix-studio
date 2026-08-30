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
const MAX_TOTAL_MS = 60_000;
const MAX_HEAP_GROWTH = 512 * 1024 * 1024;
const started = performance.now();
const beforeHeap = process.memoryUsage().heapUsed;

const structure = {
  templateId: 'mega-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'MegaOrganizationView',
    refSection: 'MegaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

const pad = (value, width = 5) => String(value).padStart(width, '0');

function makeSnapshot(size, signerPool = 200) {
  const rows = Array.from({ length: size }, (_, index) => {
    const org = `Организация ${pad(index)}`;
    const signerIndex = index % signerPool;
    const person = `Сотрудник ${pad(signerIndex)}`;
    const flat = {
      'criterion:criterion-org': [org],
      'function:function-sign': [person],
    };
    return {
      index,
      rowCardId: `card-${size}-${index}`,
      versionId: `version-${size}-${index}`,
      fingerprint: E.fingerprintFlat(flat),
      values: { 'criterion-org': [{ id: `org-${index}`, display: org }] },
      roles: { 'function-sign': [{ id: `person-${signerIndex}`, display: person, roleTypeId: 'role-type' }] },
      flat,
    };
  });
  return {
    matrixId: `mega-matrix-${size}`,
    templateId: structure.templateId,
    rows,
    criterionIdCache: new Map(),
    roleIdByFunctionCache: new Map(),
    roleIdCache: new Map(),
  };
}

async function roundtrip(size, signerPool = 200) {
  const snapshot = makeSnapshot(size, signerPool);
  const info = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: `Mega ${size}` };
  const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
  const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, info, catalog);
  assert(bytes.byteLength < 32 * 1024 * 1024, `${size}: workbook exceeded production XLSX ceiling (${bytes.byteLength})`);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const workbook = await E.readXlsxArrayBuffer(buffer, `mega-${size}.xlsx`);
  return { snapshot, workbook, bytes };
}

// 500 rows: quick sanity roundtrip.
{
  const { snapshot, workbook } = await roundtrip(500, 100);
  const plan = E.buildPlan(workbook, structure, snapshot);
  assert(plan.counts.noop === 500 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
    `500 sanity produced mutations: ${JSON.stringify(plan.counts)}`);
}

// 1000 rows: deterministic mixed user workload.
{
  const { snapshot, workbook } = await roundtrip(1000, 200);
  const signerIndex = workbook.headers.indexOf('Подписание');
  const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
  assert(signerIndex >= 0 && signerIdIndex >= 0, 'mixed workbook signer columns unavailable');

  // 100 UPDATEs. Keep organizations unique; rotate to a different known signer.
  for (let index = 0; index < 100; index += 1) {
    const donor = workbook.rows[200 + index];
    workbook.rows[index].values[signerIndex] = donor.values[signerIndex];
    workbook.rows[index].values[signerIdIndex] = donor.values[signerIdIndex];
  }

  // 10 intentionally invalid rows -> SKIP only those rows.
  for (let index = 100; index < 110; index += 1) {
    workbook.rows[index].values[signerIndex] = '';
    workbook.rows[index].values[signerIdIndex] = '';
  }

  // 5 physical DELETEs from a high range, well below destructive guard limits.
  for (const index of [904, 903, 902, 901, 900]) workbook.rows.splice(index, 1);

  // 50 copied rows -> ADD. Hidden source identity is intentionally copied; signer is changed.
  let nextExcelRow = Math.max(...workbook.rows.map(row => Number(row.excelRow) || 0)) + 1;
  for (let offset = 0; offset < 50; offset += 1) {
    const source = workbook.rows[300 + offset];
    const donor = workbook.rows[400 + offset];
    const added = { excelRow: nextExcelRow++, values: [...source.values] };
    added.values[signerIndex] = donor.values[signerIndex];
    added.values[signerIdIndex] = donor.values[signerIdIndex];
    workbook.rows.push(added);
  }

  const plan = E.buildPlan(workbook, structure, snapshot);
  const expected = { update: 100, add: 50, delete: 5, noop: 885, skip: 10 };
  for (const [key, value] of Object.entries(expected)) {
    assert(plan.counts[key] === value, `mixed ${key}: expected ${value}, got ${plan.counts[key]} (${JSON.stringify(plan.counts)})`);
  }
  assert(E.deletionGuard(plan).blocked === false, `5/1000 mixed DELETE unexpectedly blocked: ${JSON.stringify(E.deletionGuard(plan))}`);
  assert(E.evaluateApplyBatch(plan.actions).blocked === false, 'mixed 155-mutation plan unexpectedly hit batch hard limit');

  // Full-plan review: page 3 must remain reachable, then exclude one far UPDATE by stable identity.
  const page3 = E.selectPreviewItems(plan, E.createPlanReviewState(), E.createPreviewViewState({ filter: 'update', page: 3, pageSize: 40 }));
  assert(page3.total === 100 && page3.page === 3 && page3.items.length === 20,
    `mixed far-page preview mismatch: ${JSON.stringify({ total: page3.total, page: page3.page, items: page3.items.length })}`);
  const farAction = page3.items[10]?.action;
  assert(farAction?.type === 'update', 'far-page UPDATE is not reviewable');
  const review = E.createPlanReviewState();
  E.setPlanReviewRow(review, farAction, true);
  const reviewed = E.buildReviewedPlan(plan, review);
  assert(reviewed.counts.update === 99, `far-page exclusion expected 99 UPDATEs, got ${reviewed.counts.update}`);
}

// 5000 rows: full XLSX export -> import -> planner on a large untouched matrix.
{
  const phaseStarted = performance.now();
  const { snapshot, workbook, bytes } = await roundtrip(5000, 250);
  const plan = E.buildPlan(workbook, structure, snapshot);
  const phaseMs = performance.now() - phaseStarted;
  assert(workbook.rows.length === 5000, `5000 load imported ${workbook.rows.length} rows`);
  assert(plan.counts.noop === 5000 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
    `5000 untouched load produced mutations: ${JSON.stringify(plan.counts)}`);
  console.log(`Mega 5000 roundtrip: ${Math.round(phaseMs)}ms, ${bytes.byteLength} bytes`);
}

// Operational Apply ceiling is independent from planner/XLSX capacity.
const syntheticBatch = Array.from({ length: 2001 }, (_, index) => ({ type: 'update', excelRow: { excelRow: index + 2 } }));
const batch = E.evaluateApplyBatch(syntheticBatch);
assert(batch.blocked === true && batch.count === 2001, `2001-operation hard stop failed: ${JSON.stringify(batch)}`);

const totalMs = performance.now() - started;
const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - beforeHeap);
assert(totalMs < MAX_TOTAL_MS, `mega mixed regression exceeded ${MAX_TOTAL_MS}ms: ${Math.round(totalMs)}ms`);
assert(heapGrowth < MAX_HEAP_GROWTH, `mega mixed regression heap grew by ${Math.round(heapGrowth / 1024 / 1024)} MiB`);
console.log(`TESSA Matrix Studio mega mixed-load regression: OK total=${Math.round(totalMs)}ms heap+${Math.round(heapGrowth / 1024 / 1024)}MiB`);

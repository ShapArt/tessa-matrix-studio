import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kernelPath = path.join(root, 'warehouse', 'warehouse-logistics-v14.cjs');
assert.ok(fs.existsSync(kernelPath), 'Warehouse v14 kernel file is missing');

const require = createRequire(import.meta.url);
const kernel = require(kernelPath);

assert.equal(kernel.VERSION, '14.0.0-preview');
assert.equal(
  kernel.systemCategoryForBusiness('ТО и ремонт оборудования для склада'),
  'ТО, ремонт оборудования и техники для склада',
);
assert.equal(
  kernel.systemCategoryForBusiness('ТО и ремонт спец. техники для склада'),
  'ТО, ремонт оборудования и техники для склада',
);

const targetRow = {
  rowId: 'r1',
  directorates: ['Дирекция Направлений'],
  functions: ['Складская логистика'],
  categories: ['Логистика'],
  performers: { signing: ['Соколов Лев'], specialExpert: [] },
};
assert.equal(kernel.classifyRow(targetRow).kind, 'target');
assert.equal(kernel.classifyRow({ ...targetRow, rowId: 'r2', functions: ['ИТ'] }).kind, 'unrelated');
assert.equal(kernel.classifyRow({ ...targetRow, rowId: 'r3', functions: [] }).kind, 'ambiguous');
assert.equal(
  kernel.classifyRow({ ...targetRow, rowId: 'r4', functions: ['Складская логистика', 'Производственная логистика'] }).kind,
  'shared-legacy',
);

const routeEvidence = kernel.SPEC.routes;
assert.deepEqual(routeEvidence.ordinarySigning.map(item => item.scopeKind), ['site', 'site', 'global', 'global', 'global']);
assert.deepEqual(routeEvidence.vgoRevenue.map(item => item.max), [5, 10, 100, null]);
assert.deepEqual(routeEvidence.vgoExpense.map(item => item.max), [10, null]);
assert.notDeepEqual(routeEvidence.specialExpert, routeEvidence.ordinarySigning, 'special expert route must stay independent from signing');

const facts = {
  matrix: { matrixId: 'm1', templateId: 't1' },
  structure: {},
  rows: [
    targetRow,
    { ...targetRow, rowId: 'r2', functions: ['ИТ'] },
  ],
};
const first = kernel.stablePlan(facts);
const second = kernel.stablePlan({ ...facts, rows: [...facts.rows].reverse() });
assert.equal(JSON.stringify(first), JSON.stringify(second), 'plan must be deterministic regardless of input row order');
assert.equal(first.format, 'TMS_WAREHOUSE_V14_PREVIEW_V1');
assert.ok(['ready', 'blocked', 'noop'].includes(first.status));
assert.equal(Object.hasOwn(first, 'store'), false);
assert.equal(Object.hasOwn(first, 'delete'), false);
assert.equal(Object.hasOwn(first, 'apply'), false);

const alreadyTarget = kernel.stablePlan({
  matrix: { matrixId: 'm1', templateId: 't1' },
  structure: {},
  rows: [{
    ...targetRow,
    performers: { signing: ['Гринкевич Вадим Викторович'], specialExpert: [] },
  }],
});
assert.equal(alreadyTarget.status, 'noop');
assert.ok(alreadyTarget.actions.every(action => action.type === 'NOOP'));

console.log('Warehouse v14 kernel contract: OK');

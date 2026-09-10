import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = path.join(root, 'warehouse', 'warehouse-v14-runtime.js');
assert.ok(fs.existsSync(runtimePath), 'Warehouse v14 browser runtime file is missing');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');

function execute(windowObject) {
  const context = vm.createContext({ window: windowObject, globalThis: windowObject, console });
  vm.runInContext(runtimeSource, context, { filename: runtimePath });
  return windowObject.__TMS_WAREHOUSE_V14__;
}

{
  const api = execute({});
  assert.equal(api.status, 'incompatible');
  assert.equal(api.error.code, 'TMS_WAREHOUSE_V14_INCOMPATIBLE');
}

{
  const calls = { create: 0, structure: 0, snapshot: 0, facts: 0, plan: 0 };
  const sourceSnapshot = {
    rows: [{ rowId: 'r1', flat: { Function: 'Складская логистика' } }],
  };
  const sourceBefore = JSON.stringify(sourceSnapshot);
  const structure = { templateId: 'tpl', conditions: [], functions: [] };
  const bridge = {
    templateId: () => 'tpl',
    matrixInfo: () => ({ matrixId: 'm1', TemplateID: 'tpl' }),
    requestStructure: async templateId => {
      calls.structure++;
      assert.equal(templateId, 'tpl');
      return structure;
    },
    loadSnapshot: async actualStructure => {
      calls.snapshot++;
      assert.equal(actualStructure, structure);
      return sourceSnapshot;
    },
  };
  const fakeWindow = {
    __TMS_WAREHOUSE_V14_KERNEL__: {
      VERSION: '14.0.0-preview',
      planWarehousePreview: facts => {
        calls.plan++;
        assert.equal(facts.matrix.matrixId, 'm1');
        return { format: 'TMS_WAREHOUSE_V14_PREVIEW_V1', status: 'noop', summary: {}, actions: [], blockers: [], evidence: {} };
      },
    },
    __TESSA_MATRIX_SYNC_EXPORTS__: {
      TessaBridge: {
        create: async () => {
          calls.create++;
          return bridge;
        },
      },
      warehouseFactsFromSnapshot: (actualStructure, actualSnapshot, matrixInfo) => {
        calls.facts++;
        assert.equal(actualStructure, structure);
        assert.equal(actualSnapshot, sourceSnapshot);
        return {
          matrix: { matrixId: matrixInfo.matrixId, templateId: matrixInfo.TemplateID },
          structure: { conditions: [], functions: [] },
          rows: actualSnapshot.rows.map(row => ({ ...row, flat: { ...row.flat } })),
        };
      },
    },
  };
  const api = execute(fakeWindow);
  assert.equal(api.status, 'ready');
  for (const key of Object.keys(api)) {
    assert.ok(!/apply|store|delete|write/i.test(key), `read-only runtime exposes mutation-like key: ${key}`);
  }
  const result = await api.preview();
  assert.equal(result.status, 'noop');
  assert.deepEqual(calls, { create: 1, structure: 1, snapshot: 1, facts: 1, plan: 1 });
  assert.equal(JSON.stringify(sourceSnapshot), sourceBefore, 'runtime mutated the source snapshot');
}

console.log('Warehouse v14 browser runtime contract: OK');

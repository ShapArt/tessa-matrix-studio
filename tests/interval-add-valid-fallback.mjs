import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
};

const source = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
vm.runInThisContext(source, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

const structure = {
  templateId: 'template',
  conditions: [{ criterionRowId: 'pages', criterionName: 'Листы', operandTypeId: O.Int }],
  functions: [{ id: 'sign', name: 'Подписание', typeName: 'Исполнитель' }],
};
const fresh = {
  matrixId: 'matrix', templateId: 'template', rows: [],
  criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
};
const action = {
  type: 'add',
  excelRow: {
    excelRow: 69,
    flat: { 'criterion:pages': ['4 - 19'], 'function:sign': ['Исполнитель'] },
    ids: { 'criterion:pages': [''], 'function:sign': ['person|1'] },
    compare: { 'criterion:pages': ['range:Int:4:19'], 'function:sign': ['id:person|1'] },
    columns: new Map([
      ['pages', { id: 'pages', name: 'Листы', kind: 'criterion', key: 'criterion:pages', excelHeader: 'Листы' }],
      ['sign', { id: 'sign', name: 'Подписание', kind: 'function', key: 'function:sign', excelHeader: 'Подписание' }],
    ]),
    system: {}, hasData: true,
  },
  currentRow: null, changes: [], match: { matchedBy: 'new-row-no-id', lowConfidence: false },
};
const plan = {
  id: 'interval-add-valid-fallback', matrixId: 'matrix', actions: [action], skippedRows: [],
  counts: { update: 0, add: 1, delete: 0, noop: 0, skip: 0 },
  safety: { blocked: false, blockedReasons: [] },
};

function extractorError() {
  const error = new Error('LeftOperandExtractor is null');
  error.code = 'duplicate-interval-extractor';
  return error;
}

function makeBridge({ fallbackOutcome = 'allowed' } = {}) {
  const calls = [];
  const defaultCard = { marker: 'default' };
  const validCard = { marker: 'valid' };
  return {
    calls, defaultCard, validCard,
    matrixInfo: () => ({ matrixId: 'matrix', TemplateID: 'template', StateName: 'Черновик' }),
    templateId: () => 'template',
    requestStructure: async () => structure,
    loadSnapshot: async () => fresh,
    resolveReferenceOnline: async () => null,
    resolveRole: (_fn, display, packedId) => {
      const [id, roleTypeId] = String(packedId || '').split('|');
      return { id, display, roleTypeId };
    },
    assertCanCreateRows: () => {},
    createRowCard: async () => {
      calls.push('new:default');
      return { card: defaultCard, cardId: 'default-card', versionId: 'default-version', newMethod: 'new' };
    },
    createDiagnosticRowCard: async (_templateId, modeName) => {
      calls.push(`new:${modeName}`);
      assert.equal(modeName, 'Valid');
      return { card: validCard, cardId: 'valid-card', versionId: 'valid-version', newMethod: 'new', diagnosticNewMode: 'Valid' };
    },
    rebuildRowCard: (card) => { calls.push(`rebuild:${card.marker}`); },
    validateDuplicate: async (card) => {
      calls.push(`validate:${card.marker}`);
      if (card === defaultCard) throw extractorError();
      if (fallbackOutcome === 'allowed') return;
      if (fallbackOutcome === 'duplicate') {
        const error = new Error('duplicate'); error.code = 'duplicate-found'; throw error;
      }
      throw extractorError();
    },
  };
}

// RED: an interval ADD rejected only by the known extractor defect must retry once
// through CardNewMode.Valid, run the same server duplicate check again and prepare
// ONLY the server-accepted Valid card for Store.
{
  const bridge = makeBridge();
  const result = await E.preflightPlan(plan, { previewOnly: true, bridge, structure, fresh });
  assert.equal(result.runtimeSkips.length, 0, JSON.stringify(result.runtimeSkips));
  assert.equal(result.preparedAdds.size, 1);
  const prepared = result.preparedAdds.get(69);
  assert.equal(prepared.card, bridge.validCard, 'preflight must keep the server-validated Valid card');
  assert.equal(prepared.intervalExtractorFallback, 'CardNewMode.Valid');
  assert.deepEqual(bridge.calls, [
    'new:default', 'rebuild:default', 'validate:default',
    'new:Valid', 'rebuild:valid', 'validate:valid',
  ]);
}

// Any real duplicate must remain fail-closed. The fallback is not a bypass.
{
  const bridge = makeBridge({ fallbackOutcome: 'duplicate' });
  const result = await E.preflightPlan(plan, { previewOnly: true, bridge, structure, fresh });
  assert.equal(result.preparedAdds.size, 0);
  assert.equal(result.runtimeSkips.length, 1);
  assert.match(result.runtimeSkips[0].reason, /дубли|duplicate/i);
  assert.deepEqual(bridge.calls, [
    'new:default', 'rebuild:default', 'validate:default',
    'new:Valid', 'rebuild:valid', 'validate:valid',
  ]);
}

// Unrelated validation errors must never allocate a second CardNew.
{
  const bridge = makeBridge();
  bridge.validateDuplicate = async card => {
    bridge.calls.push(`validate:${card.marker}`);
    const error = new Error('permission denied'); error.code = 'permission-denied'; throw error;
  };
  const result = await E.preflightPlan(plan, { previewOnly: true, bridge, structure, fresh });
  assert.equal(result.preparedAdds.size, 0);
  assert.equal(result.runtimeSkips.length, 1);
  assert.deepEqual(bridge.calls, ['new:default', 'rebuild:default', 'validate:default']);
}

console.log('TESSA interval ADD CardNewMode.Valid guarded fallback regression: OK');

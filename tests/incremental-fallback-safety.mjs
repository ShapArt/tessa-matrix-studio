import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = { body: { innerText: 'Завершить редактирование и разблокировать' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });
const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const current = { rowCardId: 'card-1', versionId: 'version-1', fingerprint: 'fp-1', flat: {}, values: {}, roles: {} };
const action = { type: 'delete', currentRow: current, expectedFingerprint: 'fp-1', excelRow: null, changes: [] };
const basePlan = {
  matrixId: 'matrix-1', templateId: 'template-1', safety: { blocked: false, blockedReasons: [] },
  actions: [action], skippedRows: [], skippedFields: [], warnings: [],
};
assert(E.incrementalSafetyMode(basePlan) === 'delete', E.incrementalSafetyMode(basePlan));
assert(E.incrementalSafetyMode({ ...basePlan, crossMatrixReplacement: { enabled: true } }) === 'full-fallback', 'cross-matrix replacement must retain full preflight');
assert(E.incrementalSafetyMode({ ...basePlan, safety: { blocked: true, blockedReasons: ['blocked'] } }) === 'full-fallback', 'blocked plan must not opt into targeted mode');

let fullReads = 0;
const structure = { templateId: 'template-1', conditions: [], functions: [] };
const fresh = { matrixId: 'matrix-1', templateId: 'template-1', rows: [current] };
const bridgeWithoutDirectContext = {
  matrixInfo: () => ({ matrixId: 'matrix-1', TemplateID: 'template-1', StateName: 'Черновик' }),
  templateId: () => 'template-1',
  requestStructure: async () => structure,
  loadSnapshot: async () => { fullReads += 1; return fresh; },
  getCard: async () => ({}),
  readMatrixRowFromCard: () => current,
};
const targeted = await E.buildTargetedPreflightSnapshot(bridgeWithoutDirectContext, basePlan, structure);
assert(targeted === null, `bridge without direct context must return null targeted snapshot: ${JSON.stringify(targeted)}`);
assert(fullReads === 0, 'targeted builder itself must not silently perform full fallback');

console.log('TESSA Matrix Studio incremental fallback safety: OK');

import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

let anchorClicks = 0;
globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: tag => tag === 'a'
    ? ({ click() { anchorClicks += 1; }, style: {}, set href(_) {}, set download(_) {} })
    : ({ click() {}, style: {}, set href(_) {}, set download(_) {} }),
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;
const structure = {
  templateId: 'report-opt-in-template',
  conditions: [{ criterionRowId: 'criterion-org', criterionName: 'Организация', operandTypeId: O.ReferenceGuid, autocompleteViewName: 'QaOrganizationView', refSection: 'QaOrganizationView' }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};
const flat = { 'criterion:criterion-org': ['Организация 1'], 'function:function-sign': ['Сотрудник 1'] };
const current = {
  index: 0, rowCardId: 'card-1', versionId: 'version-1', fingerprint: E.fingerprintFlat(flat),
  values: { 'criterion-org': [{ id: 'org-1', display: 'Организация 1' }] },
  roles: { 'function-sign': [{ id: 'person-1', display: 'Сотрудник 1', roleTypeId: 'role-type' }] }, flat,
};
const snapshot = { matrixId: 'report-opt-in-matrix', templateId: structure.templateId, rows: [current], criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map() };
const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, TemplateName: 'Report Opt-in QA', StateName: 'Черновик', Name: 'Report Opt-in QA' };

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const workbook = await E.readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'report-opt-in.xlsx');
const signerIndex = workbook.headers.indexOf('Подписание');
const signerIdIndex = workbook.headers.indexOf('Подписание__ID');
workbook.rows[0].values[signerIndex] = 'Сотрудник 2';
workbook.rows[0].values[signerIdIndex] = 'person-2|role-type';
const plan = E.buildPlan(workbook, structure, snapshot);
plan.safety = { blocked: false, blockedReasons: [] };

const bridge = {
  matrixInfo: () => matrixInfo,
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => snapshot,
  resolveReferenceOnline: async () => null,
  resolveCriterion: (condition, display, id) => ({ id, display }),
  resolveRole: (fn, display, packedId) => { const [id, roleTypeId] = String(packedId || '').split('|'); return { id, display, roleTypeId: roleTypeId || 'role-type' }; },
  getCard: async rowCardId => ({ id: rowCardId }), rebuildRowCard: () => {}, validateDuplicate: async () => {}, assertCanCreateRows: () => {},
  storeRowCard: async card => ({ cardId: card?.id || 'card-1' }),
};
const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => bridge;
let result;
try { result = await E.applyPlan(plan); }
finally { E.TessaBridge.create = originalCreate; }

assert(result?.status === 'completed', `expected completed Apply, got ${JSON.stringify(result)}`);
assert(anchorClicks === 0, `successful Apply must not auto-download JSON; got ${anchorClicks} automatic download(s)`);
assert(code.includes('id="tms-download-report"'), 'manual report download control is missing');
assert(!/downloadJson\(result,\s*`TESSA_Matrix_Apply_/.test(code), 'Apply result still auto-downloads JSON');
assert(!/downloadJson\(\{ app: \{ name: APP\.name/.test(code), 'caught Apply error still auto-downloads ErrorReport JSON');

console.log('TESSA Matrix Studio diagnostic reports are opt-in, not automatic downloads: OK');

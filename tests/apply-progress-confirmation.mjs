import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;

const functionColumn = {
  id: 'function-sign',
  name: 'Подписание',
  kind: 'function',
  key: 'function:function-sign',
  excelHeader: 'Подписание',
};
const structure = {
  templateId: 'progress-template',
  conditions: [],
  functions: [{ id: functionColumn.id, name: functionColumn.name, typeName: functionColumn.name }],
};
const excelRow = {
  excelRow: 151,
  flat: { [functionColumn.key]: ['Иванов И.И.'] },
  ids: { [functionColumn.key]: ['signer-1|role-type'] },
  compare: { [functionColumn.key]: ['id:signer-1|role-type'] },
  columns: new Map([[functionColumn.id, functionColumn]]),
  system: {},
  hasData: true,
};
const action = {
  type: 'add',
  excelRow,
  currentRow: null,
  changes: [],
  match: { matchedBy: 'new-row-no-id', lowConfidence: false },
  expectedFingerprint: null,
};
const plan = {
  id: 'apply-progress-confirmation',
  matrixId: 'progress-matrix',
  actions: [action],
  skippedRows: [],
  safety: { blocked: false, blockedReasons: [] },
};
const fresh = {
  matrixId: plan.matrixId,
  templateId: structure.templateId,
  rows: [],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};

let releaseCreate;
const createGate = new Promise(resolve => { releaseCreate = resolve; });
let createStarted = false;
const bridge = {
  matrixInfo: () => ({ matrixId: plan.matrixId, TemplateID: structure.templateId, StateName: 'Черновик' }),
  templateId: () => structure.templateId,
  requestStructure: async () => structure,
  loadSnapshot: async () => fresh,
  resolveRole: (fn, display, id) => ({ id, display }),
  resolveReferenceOnline: async () => null,
  assertCanCreateRows: () => {},
  createRowCard: async () => {
    createStarted = true;
    await createGate;
    return { card: {}, cardId: 'new-card', versionId: 'new-version', newMethod: 'CardNew' };
  },
  rebuildRowCard: () => {},
  validateDuplicate: async () => {},
};

const progress = [];
const pending = E.preflightPlan(plan, {
  bridge,
  structure,
  onProgress: (percent, label, detail) => progress.push({ percent, label: String(label || ''), detail: String(detail || '') }),
});

for (let i = 0; i < 20 && !createStarted; i += 1) await sleep(10);
assert(createStarted, 'ADD preflight did not reach the simulated TESSA request');
const waiting = progress.find(item => /нов(ые|ых) строк/i.test(item.label) && /0 из 1/.test(item.detail));
assert(waiting, `before the first TESSA response UI must show 0/1 and the active ADD phase: ${JSON.stringify(progress)}`);

const progressCountBeforeHeartbeat = progress.length;
await sleep(1100);
assert(progress.length > progressCountBeforeHeartbeat,
  `while TESSA is still answering, progress must emit a heartbeat instead of looking frozen: ${JSON.stringify(progress)}`);
assert(progress.some(item => /жду|прошло/i.test(item.detail)),
  `heartbeat must explain that TESSA is being awaited: ${JSON.stringify(progress.slice(-4))}`);

releaseCreate();
const result = await pending;
assert(result.preparedAdds.size === 1, `ADD must still complete after heartbeat: ${result.preparedAdds.size}`);

// One normal Apply confirmation is enough. DELETE count is already visible in that summary;
// a second browser-native confirm adds no safety because Preview can exclude DELETE explicitly.
assert(!code.includes("if (c.delete && !window.confirm(`Будет удалено строк: ${c.delete}. Подтвердите удаление отдельно.`)) return null;"),
  'Apply must not show a second DELETE-only browser confirm');

console.log('TESSA Matrix Studio Apply progress + confirmation UX: OK');

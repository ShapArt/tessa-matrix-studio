import fs from 'node:fs';
import vm from 'node:vm';

const scriptPath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const code = fs.readFileSync(scriptPath, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
  body: { innerText: 'Завершить редактирование и разблокировать' },
  querySelector: () => null,
  querySelectorAll: () => [],
};
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
const O = E.constants.OPERAND;

const structure = {
  templateId: 'qa-template',
  conditions: [{
    criterionRowId: 'criterion-org',
    criterionName: 'Организация',
    operandTypeId: O.ReferenceGuid,
    autocompleteViewName: 'QaOrganizationView',
    refSection: 'QaOrganizationView',
  }],
  functions: [{ id: 'function-sign', name: 'Подписание', typeName: 'Подписание' }],
};

function currentRow(index, rowCardId, versionId, orgId, org, personId, person) {
  const flat = {
    'criterion:criterion-org': [org],
    'function:function-sign': [person],
  };
  return {
    index,
    rowCardId,
    versionId,
    fingerprint: E.fingerprintFlat(flat),
    values: { 'criterion-org': [{ id: orgId, display: org }] },
    roles: { 'function-sign': [{ id: personId, display: person, roleTypeId: 'role-type' }] },
    flat,
  };
}

const snapshot = {
  matrixId: 'qa-matrix',
  templateId: 'qa-template',
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-a', 'Иванов И.И.'),
    currentRow(1, 'card-b', 'version-b', 'org-b', 'Компания Б', 'person-b', 'Петров П.П.'),
  ],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};

const matrixInfo = {
  matrixId: snapshot.matrixId,
  TemplateID: snapshot.templateId,
  TemplateName: 'QA Matrix',
  StateName: 'Черновик',
  Name: 'QA Matrix',
};

const catalog = E.mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const baseline = await E.readXlsxArrayBuffer(buffer, 'qa-acceptance.xlsx');

const cloneWorkbook = workbook => ({
  ...workbook,
  rows: workbook.rows.map(row => ({ excelRow: row.excelRow, values: [...row.values] })),
});
const headerIndex = name => baseline.headers.indexOf(name);
const orgIndex = headerIndex('Организация');
const orgIdIndex = headerIndex('Организация__ID');
const signerIndex = headerIndex('Подписание');
const signerIdIndex = headerIndex('Подписание__ID');
assert([orgIndex, orgIdIndex, signerIndex, signerIdIndex].every(i => i >= 0), 'required roundtrip columns unavailable');

// 1. NOOP — чистый roundtrip не создаёт изменений.
let plan = E.buildPlan(baseline, structure, snapshot);
assert(plan.counts.noop === 2 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `NOOP mismatch: ${JSON.stringify(plan.counts)}`);

// 2. PATCH — обычная правка существующей строки остаётся UPDATE этой же identity.
const patch = cloneWorkbook(baseline);
patch.rows[0].values[signerIndex] = baseline.rows[1].values[signerIndex];
patch.rows[0].values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
plan = E.buildPlan(patch, structure, snapshot);
assert(plan.counts.update === 1 && plan.counts.noop === 1 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `PATCH mismatch: ${JSON.stringify(plan.counts)}`);
const patchAction = plan.actions.find(action => action.type === 'update');
assert(patchAction?.currentRow?.versionId === 'version-a', 'PATCH changed target identity');

// 3. ADD — копия в новую строку создаёт ADD и не удаляет исходную.
const add = cloneWorkbook(baseline);
const newRow = { excelRow: baseline.rows.at(-1).excelRow + 1, values: [...baseline.rows[0].values] };
newRow.values[signerIndex] = baseline.rows[1].values[signerIndex];
newRow.values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
add.rows.push(newRow);
plan = E.buildPlan(add, structure, snapshot);
assert(plan.counts.add === 1 && plan.counts.noop === 2 && plan.counts.update === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `ADD mismatch: ${JSON.stringify(plan.counts)}`);
assert(plan.actions.find(action => action.type === 'add')?.match?.matchedBy === 'copied-row-auto-add',
  'copy in a new row must be copied-row-auto-add');

// 4. REPLACE — Ctrl+C/Ctrl+V поверх существующей строки обновляет цель по позиции.
const replace = cloneWorkbook(baseline);
replace.rows[1].values = [...replace.rows[0].values];
replace.rows[1].values[signerIndex] = baseline.rows[1].values[signerIndex];
replace.rows[1].values[signerIdIndex] = baseline.rows[1].values[signerIdIndex];
plan = E.buildPlan(replace, structure, snapshot);
const replacement = plan.actions.find(action => action.type === 'update');
assert(plan.counts.update === 1 && plan.counts.noop === 1 && plan.counts.add === 0 && plan.counts.delete === 0 && plan.counts.skip === 0,
  `REPLACE mismatch: ${JSON.stringify(plan.counts)}`);
assert(replacement?.currentRow?.versionId === 'version-b' && replacement?.match?.matchedBy === 'position-overwrite',
  'REPLACE must preserve target identity and use position-overwrite');

// 5. DELETE — физическое удаление одной строки остаётся DELETE.
const removed = cloneWorkbook(baseline);
removed.rows.splice(1, 1);
plan = E.buildPlan(removed, structure, snapshot);
assert(plan.counts.delete === 1 && plan.counts.noop === 1 && plan.counts.update === 0 && plan.counts.add === 0 && plan.counts.skip === 0,
  `DELETE mismatch: ${JSON.stringify(plan.counts)}`);

// 6. Ошибка одной строки не ломает пакет: строка без исполнителя уходит в SKIP.
const noRole = cloneWorkbook(baseline);
noRole.rows[0].values[signerIndex] = '';
noRole.rows[0].values[signerIdIndex] = '';
plan = E.buildPlan(noRole, structure, snapshot);
assert(plan.counts.skip === 1 && plan.counts.noop === 1 && plan.counts.update === 0,
  `role SKIP mismatch: ${JSON.stringify(plan.counts)}`);
assert(plan.skippedRows.some(item => /исполнител/i.test(item.reason)), 'role SKIP reason is missing');

// 7. Массовое удаление защищено отдельным guard.
assert(E.deletionGuard({ counts: { delete: 10 }, sourceRowCount: 50 }).blocked === true, 'mass delete guard must block 10/50');
assert(E.deletionGuard({ counts: { delete: 9 }, sourceRowCount: 50 }).blocked === false, 'mass delete guard must not block 9/50');

function makeBridge(fresh = snapshot, options = {}) {
  return {
    matrixInfo: () => ({ ...matrixInfo, ...(options.matrixInfo || {}) }),
    templateId: () => structure.templateId,
    requestStructure: async () => structure,
    loadSnapshot: async () => fresh,
    resolveReferenceOnline: async () => null,
    resolveCriterion: (condition, display, id) => {
      if (!id) throw new Error(`Значение «${display}» не найдено в справочнике.`);
      return { id, display };
    },
    resolveRole: (fn, display, id) => {
      if (!id) throw new Error(`Роль «${display}» не найдена.`);
      return { id, display };
    },
    getCard: async () => ({}),
    rebuildRowCard: () => {},
    validateDuplicate: async () => {},
    assertCanCreateRows: () => {},
    createRowCard: async () => ({ card: {}, cardId: 'new-card', versionId: 'new-version', newMethod: 'CardNew' }),
    tryGetCard: async () => ({ card: {} }),
    storeRowCard: async () => ({ cardId: 'stored-card' }),
    deleteMatrixRow: async () => {},
    refresh: async () => {},
    ...(options.methods || {}),
  };
}

// 8. Safety — активная матрица и Excel от другой карточки блокируются целиком.
plan = E.buildPlan(patch, structure, snapshot);
let safety = E.evaluatePlanSafety(plan, makeBridge(snapshot, { matrixInfo: { StateName: 'Активная' } }));
assert(safety.blocked && safety.suppressUnsafePreview, 'active matrix must be blocked');
const foreignWorkbook = { ...baseline, roundtrip: { ...baseline.roundtrip, matrixId: 'foreign-matrix' } };
plan = E.buildPlan(foreignWorkbook, structure, snapshot);
safety = E.evaluatePlanSafety(plan, makeBridge(snapshot));
assert(safety.blocked && safety.blockedReasons.some(reason => /другой карточк/i.test(reason)),
  'foreign matrix workbook must be blocked');

// 9. Stale preview — изменение строки в TESSA после preview превращает UPDATE в runtime SKIP.
plan = E.buildPlan(patch, structure, snapshot);
const freshChanged = {
  ...snapshot,
  rows: [
    currentRow(0, 'card-a', 'version-a', 'org-a', 'Компания А', 'person-z', 'Сидоров С.С.'),
    snapshot.rows[1],
  ],
  criterionIdCache: new Map(),
  roleIdByFunctionCache: new Map(),
  roleIdCache: new Map(),
};
const originalCreate = E.TessaBridge.create;
E.TessaBridge.create = async () => makeBridge(freshChanged);
let preflight = await E.preflightPlan(plan);
assert(preflight.preparedUpdates.size === 0 && preflight.runtimeSkips.length === 1,
  'stale preview must become runtime SKIP');
assert(/проверить изменения/i.test(preflight.runtimeSkips[0].reason),
  'stale preview message must tell the user to re-check');

// 10. Неизвестное справочное значение без ID пропускает только проблемную строку.
plan = E.buildPlan(patch, structure, snapshot);
const lookupAction = plan.actions.find(action => action.type === 'update');
const orgColumn = lookupAction.excelRow.columns.get('criterion-org');
lookupAction.excelRow.flat[orgColumn.key] = ['Компания НЕИЗВЕСТНА'];
lookupAction.excelRow.ids[orgColumn.key] = [''];
E.TessaBridge.create = async () => makeBridge(snapshot);
preflight = await E.preflightPlan(plan);
assert(preflight.preparedUpdates.size === 0 && preflight.runtimeSkips.length === 1,
  'unknown dictionary value must SKIP only its row');
assert(/не найден|справоч/i.test(preflight.runtimeSkips[0].reason),
  `dictionary error was misclassified: ${preflight.runtimeSkips[0].reason}`);

// 11. Отмена в первом подтверждении выполняет ноль обращений к TESSA.
let bridgeCreated = false;
E.TessaBridge.create = async () => { bridgeCreated = true; return makeBridge(snapshot); };
globalThis.confirm = () => false;
plan = E.buildPlan(patch, structure, snapshot);
const cancelled = await E.applyPlan(plan);
assert(cancelled === null && bridgeCreated === false, 'cancel before apply must perform zero TESSA calls');

E.TessaBridge.create = originalCreate;
globalThis.confirm = () => true;

console.log('TESSA Matrix Studio acceptance tests: OK');

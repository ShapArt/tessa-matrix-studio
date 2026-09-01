# Production Self-Check + Post-Apply Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в TESSA Matrix Studio read-only проверку совместимости текущего runtime TESSA и явную post-Apply сверку фактического состояния затронутых строк без повторной записи, auto-rollback или восстановления погашенного Preview.

**Architecture:** Сохраняем single-userscript архитектуру. Capability engine и reconciliation rules реализуются как чистые функции, TessaBridge только безопасно обнаруживает runtime primitives и выполняет fresh read, а UI отображает capability/reconciliation state. Mutation receipts хранятся только в памяти вкладки и не попадают в обычный Apply-report; reconciliation использует стабильную identity и typed semantic key из `values`/`roles`, а не display-only `flat`.

**Tech Stack:** JavaScript userscript (`@grant none`, без runtime dependencies), Node.js regression tests, GitHub Actions/CodeQL.

**Spec:** `docs/superpowers/specs/2026-09-01-production-self-check-reconciliation-design.md`

## Global Constraints

- Начинать runtime-реализацию только после закрытия controlled live-gate PR #49 и интеграции/явного supersede v1.9.39.
- Capability self-check строго read-only: никакого `CardNew`, `CardStore`, `DeleteRow`, `ValidateDuplicate` или иной mutation.
- Reconciliation строго read-only и никогда не вызывает Store/Delete/ADD/rollback/repair.
- Никакого обхода штатных прав TESSA.
- Никакого `editor.refreshCard()` для self-check или reconciliation.
- Identity ambiguity остаётся fail-closed: `unknown`, а не guessed match.
- Apply-result — immutable historical receipt; reconciliation-result — отдельное более позднее наблюдение.
- Любая начавшаяся mutation по-прежнему permanently consumes текущий Preview.
- Capability gating plan-specific: отсутствие `CardNew` блокирует ADD, но не UPDATE-only Apply; отсутствие local view refresh не блокирует Store.
- В текущей реализации snapshot зависит от нативного matrix view с `MatrixRowID/MatrixVersionID`; отсутствие самого view блокирует snapshot-dependent export/analyze/apply/reconcile, пока не появится доказанный альтернативный read path.
- DELETE reconciliation подтверждает отсутствие target `RowCardID/MatrixVersionID` из текущего membership snapshot, а не физическое удаление исторической row-card из хранилища.
- Default support diagnostics строятся whitelist-ом и не содержат arbitrary `error.message`, criteria/role/business values, workbook, snapshot или private mutation receipts.
- Roundtrip V6, XLSX security limits, DELETE/batch guards и существующая race protection не меняются.

---

## File Map

Изменения остаются в существующей структуре репозитория:

- `tessa-matrix-studio.user.js` — capability model/probe, private receipt state, reconciliation pure helpers, TessaBridge fresh-read adapter и UI wiring.
- `tests/runtime-capabilities.mjs` — чистая capability-модель и operation-specific gating.
- `tests/runtime-capability-probe.mjs` — безопасное обнаружение runtime primitives без mutation calls.
- `tests/capability-ui-contract.mjs` — UI status / disabled-state contract.
- `tests/mutation-receipts.mjs` — session-only receipts только для реально успешных mutations.
- `tests/reconciliation.mjs` — UPDATE/ADD/DELETE identity + typed semantic verification.
- `tests/reconciliation-writer-lock.mjs` — bounded retry только transient read/writer-lock.
- `tests/reconciliation-ui-contract.mjs` — consumed Preview остаётся consumed; явная кнопка `Проверить результат`.
- `tests/support-report-sanitization.mjs` — privacy whitelist.
- `tests/reconciliation-performance.mjs` — 500 mutations / high-cardinality linear lookup.
- `package.json` — включение regressions в полный `npm test`.
- `README.md`, `docs/PRODUCTION-RUNBOOK.md`, `docs/UAT-COMPACT-ALL-CASES.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/bug_report.yml` — пользовательский/эксплуатационный контракт и release metadata.

Не выносить runtime-код в новые импортируемые JS-модули: production userscript сейчас dependency-free и тесты уже используют test-mode exports из единого файла.

---

### Task 1: Pure Runtime Capability Model + Plan-Specific Availability

**Files:**
- Modify: `tessa-matrix-studio.user.js` рядом с state/safety pure helpers.
- Create: `tests/runtime-capabilities.mjs`.
- Modify: `package.json`.

**Interfaces:**
- Produces: `evaluateRuntimeCapabilities(probe)` → `RuntimeCapabilities`.
- Produces: `capabilityOperationAvailability(capabilities, actions = [])` → operation availability object.
- Consumes later: Task 2 runtime probe, Task 3 UI gating.

`RuntimeCapabilities`:

```js
{
  overall: 'ready' | 'limited' | 'incompatible',
  runtime: { extensionRequire, apiLoader, workspace, editor, cardModel },
  cardService: { get, request, store, newOrCreate },
  constructors: { cardGetRequest, cardRequest, cardStoreRequest, cardNewRequest, affectVersion },
  matrix: { identity, template, stateReadable, writableState },
  nativeView: { found, paging, refresh },
  blockers: [{ code, scope }],
  warnings: [{ code, scope }],
}
```

Availability shape:

```js
{
  export: { enabled, blockers },
  analyze: { enabled, blockers },
  apply: { enabled, blockers },
  refreshView: { enabled, blockers },
  reconcile: { enabled, blockers },
}
```

- [ ] **Step 1: Write failing capability regression**

Create `tests/runtime-capabilities.mjs` using the existing VM harness pattern:

```js
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../tessa-matrix-studio.user.js', import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

globalThis.window = globalThis;
globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__ = true;
globalThis.location = { origin: 'https://tessa.cherkizovsky.net' };
globalThis.document = { body: { innerText: '' }, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {} }) };
vm.runInThisContext(code, { filename: 'tessa-matrix-studio.user.js' });

const E = globalThis.__TESSA_MATRIX_SYNC_EXPORTS__;
assert(typeof E.evaluateRuntimeCapabilities === 'function', 'evaluateRuntimeCapabilities is missing');
assert(typeof E.capabilityOperationAvailability === 'function', 'capabilityOperationAvailability is missing');

const readyProbe = {
  runtime: { extensionRequire: true, apiLoader: true, workspace: true, editor: true, cardModel: true },
  cardService: { get: true, request: true, store: true, newOrCreate: true },
  constructors: { cardGetRequest: true, cardRequest: true, cardStoreRequest: true, cardNewRequest: true, affectVersion: true },
  matrix: { identity: true, template: true, stateReadable: true, writableState: true },
  nativeView: { found: true, paging: true, refresh: true },
};

const ready = E.evaluateRuntimeCapabilities(readyProbe);
assert(ready.overall === 'ready', JSON.stringify(ready));
assert(E.capabilityOperationAvailability(ready, [{ type: 'update' }]).apply.enabled === true, 'ready UPDATE must be applicable');

const noCreate = E.evaluateRuntimeCapabilities({
  ...readyProbe,
  cardService: { ...readyProbe.cardService, newOrCreate: false },
});
assert(E.capabilityOperationAvailability(noCreate, [{ type: 'update' }]).apply.enabled === true, 'missing CardNew must not block UPDATE-only Apply');
assert(E.capabilityOperationAvailability(noCreate, [{ type: 'add' }]).apply.enabled === false, 'missing CardNew must block ADD Apply');

const noRefresh = E.evaluateRuntimeCapabilities({
  ...readyProbe,
  nativeView: { ...readyProbe.nativeView, refresh: false },
});
assert(noRefresh.overall === 'limited', JSON.stringify(noRefresh));
assert(E.capabilityOperationAvailability(noRefresh, [{ type: 'update' }]).apply.enabled === true, 'view refresh is optional for Store');
assert(E.capabilityOperationAvailability(noRefresh, []).refreshView.enabled === false, 'manual view refresh must be unavailable');

const noView = E.evaluateRuntimeCapabilities({
  ...readyProbe,
  nativeView: { found: false, paging: false, refresh: false },
});
const noViewAvailability = E.capabilityOperationAvailability(noView, [{ type: 'update' }]);
assert(noViewAvailability.analyze.enabled === false, 'current snapshot path requires native matrix view');
assert(noViewAvailability.reconcile.enabled === false, 'reconciliation requires authoritative fresh snapshot');

console.log('TESSA Matrix Studio runtime capability model: OK');
```

- [ ] **Step 2: Run test to prove RED**

Run:

```bash
node tests/runtime-capabilities.mjs
```

Expected: FAIL with `evaluateRuntimeCapabilities is missing`.

- [ ] **Step 3: Implement minimal pure capability helpers**

Add helpers that only inspect booleans passed in and return stable reason codes. Use explicit plan-type requirements:

```js
function evaluateRuntimeCapabilities(probe = {}) {
  const p = probe || {};
  const blockers = [];
  const warnings = [];
  const addBlocker = (code, scope) => blockers.push({ code, scope });
  const addWarning = (code, scope) => warnings.push({ code, scope });

  if (!p.runtime?.extensionRequire) addBlocker('runtime-extension-require-missing', 'snapshot');
  if (!p.runtime?.apiLoader) addBlocker('runtime-api-loader-missing', 'workspace');
  if (!p.runtime?.workspace) addBlocker('workspace-missing', 'card');
  if (!p.runtime?.editor) addBlocker('editor-missing', 'card');
  if (!p.runtime?.cardModel) addBlocker('card-model-missing', 'card');
  if (!p.cardService?.get) addBlocker('card-get-missing', 'read');
  if (!p.cardService?.request) addBlocker('card-request-missing', 'request');
  if (!p.matrix?.identity || !p.matrix?.template || !p.matrix?.stateReadable) addBlocker('matrix-identity-unavailable', 'matrix');
  if (!p.nativeView?.found) addBlocker('native-view-missing', 'snapshot');
  else if (!p.nativeView?.refresh) addWarning('native-view-refresh-unavailable', 'refreshView');

  const overall = blockers.length ? 'incompatible' : warnings.length ? 'limited' : 'ready';
  return { ...p, blockers, warnings, overall };
}

function capabilityOperationAvailability(capabilities, actions = []) {
  const types = new Set((actions || []).map(action => action?.type).filter(Boolean));
  const baseRead = [
    capabilities?.runtime?.extensionRequire,
    capabilities?.runtime?.apiLoader,
    capabilities?.runtime?.workspace,
    capabilities?.runtime?.editor,
    capabilities?.runtime?.cardModel,
    capabilities?.cardService?.get,
    capabilities?.cardService?.request,
    capabilities?.constructors?.cardGetRequest,
    capabilities?.constructors?.cardRequest,
    capabilities?.matrix?.identity,
    capabilities?.matrix?.template,
    capabilities?.matrix?.stateReadable,
    capabilities?.nativeView?.found,
  ].every(Boolean);

  const applyBlockers = [];
  if (!baseRead) applyBlockers.push('snapshot-read-unavailable');
  if (!capabilities?.matrix?.writableState) applyBlockers.push('matrix-not-writable');
  if (types.has('update') && (!capabilities?.cardService?.store || !capabilities?.constructors?.cardStoreRequest || !capabilities?.constructors?.affectVersion)) applyBlockers.push('update-store-unavailable');
  if (types.has('add') && (!capabilities?.cardService?.newOrCreate || !capabilities?.constructors?.cardNewRequest || !capabilities?.cardService?.store)) applyBlockers.push('add-store-unavailable');
  if (types.has('delete') && (!capabilities?.cardService?.request || !capabilities?.constructors?.cardRequest)) applyBlockers.push('delete-request-unavailable');

  return {
    export: { enabled: baseRead, blockers: baseRead ? [] : ['snapshot-read-unavailable'] },
    analyze: { enabled: baseRead, blockers: baseRead ? [] : ['snapshot-read-unavailable'] },
    apply: { enabled: applyBlockers.length === 0, blockers: applyBlockers },
    refreshView: { enabled: Boolean(capabilities?.nativeView?.found && capabilities?.nativeView?.refresh), blockers: capabilities?.nativeView?.refresh ? [] : ['native-view-refresh-unavailable'] },
    reconcile: { enabled: baseRead, blockers: baseRead ? [] : ['snapshot-read-unavailable'] },
  };
}
```

Preserve detailed capability booleans even when `overall=incompatible`; UI needs to show partial availability.

- [ ] **Step 4: Export helpers in test mode and run focused test**

Run:

```bash
node tests/runtime-capabilities.mjs
```

Expected: PASS.

- [ ] **Step 5: Add test to `npm test` and run smoke/safety subset**

Run:

```bash
node tests/runtime-capabilities.mjs && node tests/smoke.mjs && node tests/acceptance.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tessa-matrix-studio.user.js tests/runtime-capabilities.mjs package.json
git commit -m "feat: model TESSA runtime capabilities"
```

---

### Task 2: Read-Only Runtime Probe + TessaBridge Capability Adapter

**Files:**
- Modify: `tessa-matrix-studio.user.js` around `captureExtensionRequire()` and `class TessaBridge` (v1.9.39 currently around lines 2580–2900).
- Create: `tests/runtime-capability-probe.mjs`.
- Modify: `package.json`.

**Interfaces:**
- Produces: `probeRuntimeEnvironment(options = {})` → pure-serializable probe consumed by `evaluateRuntimeCapabilities()`.
- Produces: `TessaBridge.runtimeCapabilities()` for an already-created bridge.
- Must not invoke server mutation methods.

- [ ] **Step 1: Write RED probe regression**

The test injects fake runtime bindings and records every method call:

```js
const calls = [];
const fakeRoot = {
  tessa: {
    apiLoader: id => id === 546914 ? { WorkspaceStorage: { instance: { currentCardWorkspace: { editor: { cardModel: { card: { id: '11111111-1111-1111-1111-111111111111', sections: {} }, controls: new Map() } } } } } } : null,
  },
};
const fakeRequire = id => {
  if (id === 9855) return { CardGetRequest: class {}, CardRequest: class {}, CardStoreRequest: class { set affectVersion(value) { this._affectVersion = value; } }, CardNewRequest: class {} };
  if (id === 9893) return { CardService: { instance: {
    get() { calls.push('get'); },
    request() { calls.push('request'); },
    store() { calls.push('store'); },
    new() { calls.push('new'); },
  } } };
  return {};
};

const probe = E.probeRuntimeEnvironment({ root: fakeRoot, extensionRequireFactory: () => fakeRequire });
assert(probe.cardService.get === true, JSON.stringify(probe));
assert(probe.cardService.newOrCreate === true, JSON.stringify(probe));
assert(calls.length === 0, `capability probe must not call server methods: ${calls}`);
```

Also test missing `apiLoader` and throwing extension-require factory return booleans/reason codes instead of throwing out of the probe.

- [ ] **Step 2: Run RED**

```bash
node tests/runtime-capability-probe.mjs
```

Expected: FAIL with `probeRuntimeEnvironment is missing`.

- [ ] **Step 3: Implement safe runtime inspection**

Use dependency injection for testability; default to real `window`/`captureExtensionRequire` in production:

```js
function probeRuntimeEnvironment(options = {}) {
  const root = options.root || window;
  const extensionRequireFactory = options.extensionRequireFactory || captureExtensionRequire;
  let extRequire = null;
  let cards = null;
  let cardService = null;
  let extensionRequireError = false;

  try {
    extRequire = extensionRequireFactory();
    cards = extRequire?.(9855) || null;
    cardService = extRequire?.(9893)?.CardService?.instance || null;
  } catch (_) {
    extensionRequireError = true;
  }

  const apiLoader = typeof root?.tessa?.apiLoader === 'function' ? root.tessa.apiLoader : null;
  let workspace = null;
  try { workspace = apiLoader?.(546914)?.WorkspaceStorage?.instance?.currentCardWorkspace || null; } catch (_) { workspace = null; }
  const editor = workspace?.editor || null;
  const cardModel = editor?.cardModel || null;
  const mainCard = cardModel?.card || null;
  const controls = cardModel?.controls || null;
  const nativeViewFound = Boolean(controls && findNativeMatrixControlFromBindings(editor));

  const storeProto = cards?.CardStoreRequest?.prototype || null;
  const affectVersion = Boolean(storeProto && ('affectVersion' in storeProto || Object.getOwnPropertyDescriptor(storeProto, 'affectVersion')));

  return {
    runtime: { extensionRequire: Boolean(extRequire) && !extensionRequireError, apiLoader: Boolean(apiLoader), workspace: Boolean(workspace), editor: Boolean(editor), cardModel: Boolean(cardModel) },
    cardService: { get: typeof cardService?.get === 'function', request: typeof cardService?.request === 'function', store: typeof cardService?.store === 'function', newOrCreate: typeof cardService?.new === 'function' || typeof cardService?.create === 'function' },
    constructors: { cardGetRequest: typeof cards?.CardGetRequest === 'function', cardRequest: typeof cards?.CardRequest === 'function', cardStoreRequest: typeof cards?.CardStoreRequest === 'function', cardNewRequest: typeof cards?.CardNewRequest === 'function', affectVersion },
    matrix: inspectMatrixIdentityReadOnly(mainCard),
    nativeView: inspectNativeViewCapabilitiesReadOnly(editor),
  };
}
```

Do not instantiate `CardNewRequest` and do not call `cardService.*` inside the probe. If `affectVersion` cannot be proven from the constructor/prototype, mark it false and fail closed for UPDATE/ADD Apply.

If sharing existing control traversal is awkward, extract only the read-only discovery portion of `findNativeMatrixControl()` into a helper that receives `editor` and uses no bridge state.

- [ ] **Step 4: Add `TessaBridge.runtimeCapabilities()`**

For an already-constructed bridge, return the same probe shape using its known bindings; do not call the server:

```js
runtimeCapabilities() {
  return evaluateRuntimeCapabilities(probeRuntimeEnvironment({
    root: window,
    extensionRequireFactory: () => this.extRequire,
  }));
}
```

- [ ] **Step 5: Run focused regressions**

```bash
node tests/runtime-capability-probe.mjs && node tests/runtime-capabilities.mjs && node tests/post-apply-view-refresh.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tessa-matrix-studio.user.js tests/runtime-capability-probe.mjs package.json
git commit -m "feat: probe TESSA runtime without mutations"
```

---

### Task 3: Capability Status UI + Operation Gating

**Files:**
- Modify: `tessa-matrix-studio.user.js` APP state, panel markup/styles and Analyze/Apply/download handlers (v1.9.39 currently around lines 42 and 6360+).
- Create: `tests/capability-ui-contract.mjs`.
- Modify: `package.json`.

**Interfaces:**
- Produces APP fields: `capabilities`, `capabilityAvailability`, `capabilityCheckedCardId`.
- Produces: `refreshRuntimeCapabilities(actions = [])`.
- Consumes Task 1–2 helpers.

- [ ] **Step 1: Write RED UI contract**

Assert userscript contains:

```js
assert(/id="tms-capability-status"/.test(code), 'capability status UI missing');
assert(/id="tms-capability-details"/.test(code), 'capability detail UI missing');
assert(/Повторить проверку/.test(code), 'manual capability recheck missing');
assert(/refreshRuntimeCapabilities/.test(code), 'runtime capability refresh wiring missing');
```

Then use exported pure `capabilityStatusModel(capabilities, availability)` and assert:

```js
const model = E.capabilityStatusModel({ overall: 'limited', warnings: [{ code: 'native-view-refresh-unavailable' }] }, {
  apply: { enabled: true, blockers: [] },
  refreshView: { enabled: false, blockers: ['native-view-refresh-unavailable'] },
});
assert(model.label === 'Среда: ограничена', JSON.stringify(model));
assert(model.applyEnabled === true, 'limited optional refresh must not block Apply');
```

- [ ] **Step 2: Run RED**

```bash
node tests/capability-ui-contract.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add session-only APP state**

```js
capabilities: null,
capabilityAvailability: null,
capabilityCheckedCardId: null,
lastMutationReceipts: null,
lastReconciliation: null,
```

`lastMutationReceipts` is added now but populated only in Task 4.

- [ ] **Step 4: Implement UI model + refresh function**

```js
function capabilityStatusModel(capabilities, availability) {
  const overall = capabilities?.overall || 'incompatible';
  return {
    label: overall === 'ready' ? 'Среда: готова' : overall === 'limited' ? 'Среда: ограничена' : 'Среда: несовместима',
    applyEnabled: Boolean(availability?.apply?.enabled),
    exportEnabled: Boolean(availability?.export?.enabled),
    analyzeEnabled: Boolean(availability?.analyze?.enabled),
    reconcileEnabled: Boolean(availability?.reconcile?.enabled),
    detailCodes: [...(capabilities?.blockers || []), ...(capabilities?.warnings || [])].map(item => item.code),
  };
}

function refreshRuntimeCapabilities(actions = []) {
  const probe = probeRuntimeEnvironment();
  APP.capabilities = evaluateRuntimeCapabilities(probe);
  APP.capabilityAvailability = capabilityOperationAvailability(APP.capabilities, actions);
  APP.capabilityCheckedCardId = probe?.matrix?.matrixId || null;
  renderCapabilityStatus();
  return APP.capabilityAvailability;
}
```

Do not include stack traces or module IDs in the primary user-facing details.

- [ ] **Step 5: Gate handlers without replacing existing safety checks**

Before download/analyze/apply, run capability refresh. For Apply pass the reviewed effective mutations:

```js
const reviewedPlan = buildReviewedPlan(APP.plan, APP.review);
const availability = refreshRuntimeCapabilities((reviewedPlan.actions || []).filter(action => action.type !== 'noop' && action.type !== 'skip'));
if (!availability.apply.enabled) throw new Error(humanCapabilityBlocker(availability.apply.blockers));
```

Keep `preflightPlan`, `assertWritableMatrixDraft`, `assertNativeEditMode`, batch/delete guards and all existing checks unchanged as second-line safety.

- [ ] **Step 6: Run focused UI/safety tests**

```bash
node tests/capability-ui-contract.mjs && node tests/review-ui-contract.mjs && node tests/apply-preview-batch-ux.mjs && node tests/acceptance.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tessa-matrix-studio.user.js tests/capability-ui-contract.mjs package.json
git commit -m "feat: surface TESSA compatibility status"
```

---

### Task 4: Private Mutation Receipts for Successful Writes

**Files:**
- Modify: `tessa-matrix-studio.user.js` semantic helpers + `applyPlan()` mutation loops.
- Create: `tests/mutation-receipts.mjs`.
- Modify: `package.json`.

**Interfaces:**
- Produces: `reconciliationSemanticKey(row, structure)`.
- Produces: `createMutationReceipt({ type, action, identity, expectedRow, structure })`.
- Produces session-only `APP.lastMutationReceipts = { planId, matrixId, templateId, receipts, createdAt }`.
- Receipts must never be copied into `rememberReport(result, ...)`.

Receipt shape:

```js
{
  type: 'update' | 'add' | 'delete',
  excelRow: number | null,
  rowCardId: string | null,
  versionId: string | null,
  expectedSemanticKey: string | null,
}
```

- [ ] **Step 1: Write RED semantic-key tests**

Build normalized snapshot rows using existing `values`/`roles` shape:

```js
const structure = {
  conditions: [{ criterionRowId: 'criterion-1', operandTypeId: E.OPERAND?.ReferenceGuid || 'reference-guid' }],
  functions: [{ id: 'function-1' }],
};
const rowA = {
  values: { 'criterion-1': [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', display: 'Старое имя', kind: 'ReferenceGuid' }] },
  roles: { 'function-1': [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roleTypeId: 1, display: 'Иванов И.И.' }] },
};
const rowB = {
  values: { 'criterion-1': [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', display: 'Новое имя', kind: 'ReferenceGuid' }] },
  roles: { 'function-1': [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', roleTypeId: 1, display: 'Иванов Иван' }] },
};
assert(E.reconciliationSemanticKey(rowA, structure) === E.reconciliationSemanticKey(rowB, structure), 'display-only rename with stable IDs must remain semantically equal');
```

Also assert changed reference ID, changed Boolean/range value or changed role ID changes the key; multivalue order must not change the key.

- [ ] **Step 2: Run RED**

```bash
node tests/mutation-receipts.mjs
```

Expected: FAIL with missing helper.

- [ ] **Step 3: Implement typed ID-first semantic key**

Use `row.values` and `row.roles`, never only `row.flat`:

```js
function semanticCriterionItem(item) {
  if (item?.id !== null && item?.id !== undefined && item?.id !== '') return `ref:${canonicalValue(item.id)}`;
  const kind = canonicalValue(item?.kind || 'string');
  if (kind === 'boolean') return `bool:${item?.value ? 1 : 0}`;
  if (['int', 'decimal', 'date', 'datetime'].includes(kind)) {
    return `${kind}:${typedScalarSemantic(item?.value, kind)}:${item?.to === null || item?.to === undefined ? '' : typedScalarSemantic(item.to, kind)}`;
  }
  return `text:${canonicalValue(item?.value ?? item?.display ?? '')}`;
}

function reconciliationSemanticKey(row, structure) {
  const parts = [];
  for (const condition of [...(structure?.conditions || [])].sort((a, b) => canonicalValue(a.criterionRowId).localeCompare(canonicalValue(b.criterionRowId)))) {
    const items = (row?.values?.[condition.criterionRowId] || []).map(semanticCriterionItem).sort();
    parts.push(`c:${canonicalValue(condition.criterionRowId)}=[${items.join(',')}]`);
  }
  for (const fn of [...(structure?.functions || [])].sort((a, b) => canonicalValue(a.id).localeCompare(canonicalValue(b.id)))) {
    const items = (row?.roles?.[fn.id] || []).map(item => `role:${canonicalValue(item.id)}:${Number(item.roleTypeId ?? '')}`).sort();
    parts.push(`f:${canonicalValue(fn.id)}=[${items.join(',')}]`);
  }
  return hashText(parts.join('|'));
}
```

If existing `typedScalarSemantic()` takes operand IDs rather than kind strings, adapt the call to its exact signature instead of adding a second numeric/date parser.

- [ ] **Step 4: Build receipt from authoritative prepared local card**

For UPDATE/ADD, compute the expected normalized row from the rebuilt card before Store using existing `readMatrixRowFromCard()`; this gives IDs/typed values while remaining independent of later server display renames.

Example UPDATE integration:

```js
const expectedRow = bridge.readMatrixRowFromCard(prepared.card, {
  index: prepared.current.index,
  rowCardId: prepared.current.rowCardId,
  versionId: prepared.current.versionId,
  rowName: prepared.current.rowName,
  source: 'apply-expected-update',
}, structure);
await bridge.storeRowCard(prepared.card);
receipts.push(createMutationReceipt({
  type: 'update',
  action,
  identity: { rowCardId: prepared.current.rowCardId, versionId: prepared.current.versionId },
  expectedRow,
  structure,
}));
```

ADD uses `created.cardId/created.versionId`; DELETE stores both `prepared.current.rowCardId` and `prepared.current.versionId` and `expectedSemanticKey:null`.

- [ ] **Step 5: Store receipts only after successful mutation**

Initialize local `receipts=[]` before loops. Do not append on `status:'skipped'`. At Apply completion:

```js
APP.lastMutationReceipts = result.startedCount > 0 ? {
  planId: plan.id,
  matrixId: plan.matrixId,
  templateId: structure.templateId,
  receipts,
  createdAt: nowIso(),
} : null;
```

Do not add `expectedSemanticKey` or `receipts` to `result` passed to `rememberReport`.

- [ ] **Step 6: Test successful-only capture and existing result accounting**

`tests/mutation-receipts.mjs` must assert:

- successful UPDATE receipt exists;
- successful ADD receipt contains both generated RowCardID and MatrixVersionID;
- successful DELETE receipt contains both target IDs;
- skipped Store has no receipt;
- `APP.lastMutationReceipts` remains available after `invalidatePlanStateAfterApply()` consumes the Preview;
- `JSON.stringify(APP.lastReport)` does not contain `expectedSemanticKey`.

Run:

```bash
node tests/mutation-receipts.mjs && node tests/apply-result-accounting.mjs && node tests/apply-plan-consumed.mjs && node tests/apply-report-opt-in.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tessa-matrix-studio.user.js tests/mutation-receipts.mjs package.json
git commit -m "feat: retain private mutation receipts"
```

---

### Task 5: Pure Reconciliation Engine + Bounded Fresh-Read Retry

**Files:**
- Modify: `tessa-matrix-studio.user.js`.
- Create: `tests/reconciliation.mjs`.
- Create: `tests/reconciliation-writer-lock.mjs`.
- Create: `tests/reconciliation-performance.mjs`.
- Modify: `package.json`.

**Interfaces:**
- Produces: `indexSnapshotForReconciliation(snapshot)`.
- Produces: `reconcileMutationReceipts(receipts, snapshot, structure)`.
- Produces: `runReconciliationRead(bridgeFactory, receiptContext, options = {})`.
- Consumes Task 4 receipts and semantic key.

- [ ] **Step 1: Write RED reconciliation matrix**

Create `tests/reconciliation.mjs` with at least these cases:

```js
const snapshot = {
  matrixId: 'matrix-1',
  templateId: 'template-1',
  rows: [
    { rowCardId: 'card-u', versionId: 'ver-u', values: {}, roles: {}, semantic: 'update-row' },
    { rowCardId: 'card-a', versionId: 'ver-a', values: {}, roles: {}, semantic: 'add-row' },
  ],
};
```

Use real `values`/`roles` fixtures, then receipts whose `expectedSemanticKey` comes from `reconciliationSemanticKey()`.

Assertions:

- UPDATE matching `rowCardId` + semantic key → `verified`;
- UPDATE same identity but changed semantic state → `divergent`;
- UPDATE target absent → row status `missing`, overall `divergent`;
- ADD exact created identity + semantic key → `verified`;
- ADD receipt without provable RowCardID/VersionID → `unknown`, never match by similar values;
- DELETE both RowCardID/VersionID absent from fresh membership snapshot → `verified`;
- DELETE target VersionID absent but same RowCardID still current with another version → `divergent`;
- one divergent among 100 verified → exact counts and overall `divergent`;
- any `unknown` without divergence → overall `incomplete`.

- [ ] **Step 2: Run RED**

```bash
node tests/reconciliation.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement O(1) snapshot indexes**

```js
function indexSnapshotForReconciliation(snapshot) {
  const byCard = new Map();
  const byVersion = new Map();
  for (const row of snapshot?.rows || []) {
    const card = canonicalValue(row?.rowCardId || '');
    const version = canonicalValue(row?.versionId || '');
    if (card) byCard.set(card, row);
    if (version) byVersion.set(version, row);
  }
  return { byCard, byVersion, rowCount: (snapshot?.rows || []).length };
}
```

- [ ] **Step 4: Implement strict reconciliation rules**

```js
function reconcileMutationReceipts(receipts, snapshot, structure) {
  const index = indexSnapshotForReconciliation(snapshot);
  const rows = [];
  for (const receipt of receipts || []) {
    const byCard = receipt.rowCardId ? index.byCard.get(canonicalValue(receipt.rowCardId)) : null;
    const byVersion = receipt.versionId ? index.byVersion.get(canonicalValue(receipt.versionId)) : null;

    if (receipt.type === 'delete') {
      if (byCard || byVersion) rows.push({ type: 'delete', excelRow: receipt.excelRow ?? null, status: 'divergent', reasonCode: 'reconcile-delete-still-member' });
      else rows.push({ type: 'delete', excelRow: receipt.excelRow ?? null, status: 'verified', reasonCode: 'reconcile-delete-absent' });
      continue;
    }

    if (!receipt.rowCardId && !receipt.versionId) {
      rows.push({ type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-unknown' });
      continue;
    }

    const current = byCard || byVersion;
    if (!current) {
      rows.push({ type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'missing', reasonCode: 'reconcile-target-missing' });
      continue;
    }

    const actualKey = reconciliationSemanticKey(current, structure);
    rows.push(actualKey === receipt.expectedSemanticKey
      ? { type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'verified', reasonCode: 'reconcile-match' }
      : { type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'divergent', reasonCode: 'reconcile-semantic-divergence' });
  }

  const count = status => rows.filter(row => row.status === status).length;
  const divergentCount = count('divergent');
  const missingCount = count('missing');
  const unknownCount = count('unknown');
  return {
    status: divergentCount || missingCount ? 'divergent' : unknownCount ? 'incomplete' : 'verified',
    checkedCount: rows.length,
    verifiedCount: count('verified'),
    divergentCount,
    missingCount,
    unknownCount,
    rows,
  };
}
```

- [ ] **Step 5: Write writer-lock RED test**

`tests/reconciliation-writer-lock.mjs` injects bridge factory whose `loadSnapshot()` fails twice with `MatrixRow.WriteHeartbit ObtainWriterLock` then succeeds. Assert exactly 3 attempts. A `permission denied` failure must make exactly 1 attempt and return/throw non-retryable result.

- [ ] **Step 6: Implement fresh read orchestration**

```js
async function runReconciliationRead(bridgeFactory, receiptContext, options = {}) {
  const attempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 450));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && baseDelayMs) await sleep(baseDelayMs * (2 ** (attempt - 2)));
    try {
      const bridge = await bridgeFactory();
      const structure = await bridge.requestStructure(receiptContext.templateId);
      const snapshot = await bridge.loadSnapshot(structure);
      if (canonicalValue(snapshot.matrixId) !== canonicalValue(receiptContext.matrixId)) throw new Error('reconcile-matrix-changed');
      return { ...reconcileMutationReceipts(receiptContext.receipts, snapshot, structure), attempts: attempt, retryable: false, startedAt: options.startedAt || nowIso(), finishedAt: nowIso() };
    } catch (error) {
      lastError = error;
      if (!isWriterLockError(error) || attempt >= attempts) break;
    }
  }
  return {
    status: 'incomplete', checkedCount: 0, verifiedCount: 0, divergentCount: 0, missingCount: 0, unknownCount: receiptContext?.receipts?.length || 0,
    rows: [], attempts, retryable: isWriterLockError(lastError), reasonCode: isWriterLockError(lastError) ? 'reconcile-writer-lock' : 'reconcile-read-failed', startedAt: options.startedAt || nowIso(), finishedAt: nowIso(),
  };
}
```

Do not put raw `lastError.message` into this result; log it only in the in-memory developer log if needed.

- [ ] **Step 7: Add 500-row performance regression**

Generate a 20,000-row fresh snapshot + 500 receipts. Use deterministic IDs and assert all 500 verified. Broad CI ceiling: reconciliation pure helper under 2 seconds on GitHub runner; this is a hang/quadratic detector, not an SLA.

The test must fail if implementation calls `.find()` over all snapshot rows per receipt; inspect the helper source or instrument a custom iterable so lookup count remains O(snapshot + receipts).

- [ ] **Step 8: Run reconciliation suite**

```bash
node tests/reconciliation.mjs && node tests/reconciliation-writer-lock.mjs && node tests/reconciliation-performance.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add tessa-matrix-studio.user.js tests/reconciliation.mjs tests/reconciliation-writer-lock.mjs tests/reconciliation-performance.mjs package.json
git commit -m "feat: verify applied mutations read-only"
```

---

### Task 6: Explicit Reconciliation UI in Consumed Apply State

**Files:**
- Modify: `tessa-matrix-studio.user.js` `renderPlanConsumedNotice()`, panel markup/styles, apply handler and new reconciliation handler.
- Create: `tests/reconciliation-ui-contract.mjs`.
- Modify: `package.json`.

**Interfaces:**
- Consumes: `APP.lastMutationReceipts`, Task 5 `runReconciliationRead()`.
- Produces: `APP.lastReconciliation` and `reconciliationSummary(result)`.
- Does not change `APP.plan` from consumed/null back to executable.

- [ ] **Step 1: Write RED UI/state regression**

Assert markup contains:

```js
assert(/id="tms-reconcile"/.test(code), 'Проверить результат button missing');
assert(/Проверить результат/.test(code), 'reconciliation label missing');
assert(/id="tms-reconciliation-result"/.test(code), 'reconciliation result host missing');
```

Export `reconciliationSummary()` and assert:

```js
const summary = E.reconciliationSummary({ status: 'divergent', checkedCount: 11, verifiedCount: 10, divergentCount: 1, missingCount: 0, unknownCount: 0 });
assert(/10/.test(summary) && /1/.test(summary), summary);
```

Then simulate `invalidatePlanStateAfterApply(APP, completedResult)` and reconciliation state update; assert consumed plan remains unavailable after reconciliation.

- [ ] **Step 2: Run RED**

```bash
node tests/reconciliation-ui-contract.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add button only when receipts exist**

Panel step 4 adds:

```html
<button id="tms-reconcile" class="tms-ghost" hidden disabled>Проверить результат</button>
<div id="tms-reconciliation-result" class="tms-step-caption"></div>
```

`renderPlanConsumedNotice()` shows/enables it only when `APP.lastMutationReceipts?.receipts?.length > 0` and current capability availability allows reconciliation.

- [ ] **Step 4: Implement explicit handler**

```js
panel.querySelector('#tms-reconcile').addEventListener('click', async () => {
  if (APP.busy || !APP.lastMutationReceipts?.receipts?.length) return;
  setBusy(true);
  try {
    const availability = refreshRuntimeCapabilities([]);
    if (!availability.reconcile.enabled) throw new Error(humanCapabilityBlocker(availability.reconcile.blockers));
    setProgress(20, 'Проверяю результат', 'Читаю свежий snapshot TESSA · без записи');
    APP.lastReconciliation = await runReconciliationRead(() => TessaBridge.create(), APP.lastMutationReceipts, { attempts: 3, baseDelayMs: 450 });
    renderReconciliationResult(APP.lastReconciliation);
    setProgress(100, 'Проверка результата завершена', reconciliationSummary(APP.lastReconciliation));
  } catch (error) {
    APP.lastReconciliation = { status: 'incomplete', retryable: isWriterLockError(error), reasonCode: isWriterLockError(error) ? 'reconcile-writer-lock' : 'reconcile-read-failed' };
    renderReconciliationResult(APP.lastReconciliation);
  } finally {
    setBusy(false);
  }
});
```

Important: `TessaBridge.create()` currently checks unsaved local card changes. Keep that safety check for reconciliation; do not silently read through unsaved edits.

- [ ] **Step 5: Keep Apply result immutable in UI**

Do not modify `APP.lastReport`, `result.status`, `result.success`, or Apply counters when reconciliation is divergent. Render two separate facts:

```text
Запись: завершена · 11/11
Проверка результата: подтверждено 10 · расхождение 1
```

- [ ] **Step 6: Preserve manual refresh behavior from v1.9.39**

`#tms-refresh-view` remains independent. Failed view refresh does not disable `#tms-reconcile`; successful reconciliation does not hide/pretend to refresh the native view.

- [ ] **Step 7: Run focused regressions**

```bash
node tests/reconciliation-ui-contract.mjs && node tests/sticky-progress-ui.mjs && node tests/post-apply-view-refresh.mjs && node tests/apply-plan-consumed.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tessa-matrix-studio.user.js tests/reconciliation-ui-contract.mjs package.json
git commit -m "feat: add explicit post-Apply verification"
```

---

### Task 7: Privacy-Safe Support Diagnostics

**Files:**
- Modify: `tessa-matrix-studio.user.js` report helpers.
- Create: `tests/support-report-sanitization.mjs`.
- Modify: `package.json`.

**Interfaces:**
- Produces: `sanitizeSupportReport(input, options = {})`.
- Default output is a whitelist; no recursive pass-through of unknown fields.

- [ ] **Step 1: Write RED privacy regression**

Fixture intentionally contains business-sensitive strings in every unsafe location:

```js
const unsafe = {
  version: '1.9.40',
  matrixId: 'matrix-id',
  templateId: 'template-id',
  capabilities: { overall: 'limited', blockers: [{ code: 'native-view-refresh-unavailable', scope: 'refreshView' }] },
  reconciliation: { status: 'divergent', checkedCount: 2, verifiedCount: 1, divergentCount: 1, rows: [{ excelRow: 15, reasonCode: 'reconcile-semantic-divergence', value: 'СЕКРЕТНЫЙ КОНТРАГЕНТ' }] },
  receipts: [{ expectedSemanticKey: 'hash-with-private-source' }],
  workbook: { rows: ['СЕКРЕТНЫЙ КОНТРАГЕНТ'] },
  snapshot: { rows: ['Иванов Иван Иванович'] },
  error: { message: 'Не найден ID роли Иванов Иван Иванович' },
  logs: ['Компания Ромашка'],
};
const safe = E.sanitizeSupportReport(unsafe, { includeIds: false });
const text = JSON.stringify(safe);
for (const forbidden of ['СЕКРЕТНЫЙ', 'Иванов', 'Ромашка', 'expectedSemanticKey', 'workbook', 'snapshot', 'receipts', 'error']) assert(!text.includes(forbidden), text);
assert(!text.includes('matrix-id') && !text.includes('template-id'), 'IDs require explicit includeIds');
const withIds = E.sanitizeSupportReport(unsafe, { includeIds: true });
assert(withIds.matrixId === 'matrix-id' && withIds.templateId === 'template-id', JSON.stringify(withIds));
```

- [ ] **Step 2: Run RED**

```bash
node tests/support-report-sanitization.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement strict whitelist**

```js
function sanitizeSupportReport(input = {}, options = {}) {
  const reconciliation = input.reconciliation || {};
  return {
    studioVersion: String(input.version || APP.version),
    createdAt: nowIso(),
    ...(options.includeIds ? { matrixId: input.matrixId || null, templateId: input.templateId || null } : {}),
    capabilities: {
      overall: input.capabilities?.overall || null,
      blockers: (input.capabilities?.blockers || []).map(item => ({ code: item.code, scope: item.scope })),
      warnings: (input.capabilities?.warnings || []).map(item => ({ code: item.code, scope: item.scope })),
    },
    apply: input.apply ? {
      status: input.apply.status || null,
      requestedCount: Number(input.apply.requestedCount || 0),
      appliedCount: Number(input.apply.appliedCount || 0),
      failedCount: Number(input.apply.failedCount || 0),
      notStartedCount: Number(input.apply.notStartedCount || 0),
    } : null,
    reconciliation: {
      status: reconciliation.status || null,
      checkedCount: Number(reconciliation.checkedCount || 0),
      verifiedCount: Number(reconciliation.verifiedCount || 0),
      divergentCount: Number(reconciliation.divergentCount || 0),
      missingCount: Number(reconciliation.missingCount || 0),
      unknownCount: Number(reconciliation.unknownCount || 0),
      reasonCodes: [...new Set((reconciliation.rows || []).map(row => row.reasonCode).filter(Boolean))],
    },
  };
}
```

Do not append arbitrary object fields and do not include `error.message`.

- [ ] **Step 4: Wire explicit diagnostic download**

Existing `Скачать отчёт` keeps Apply report behavior unchanged. Add a separate explicit `Скачать диагностику` only if the current UI already has a natural support surface; otherwise expose sanitizer for issue-report flow without adding another button in v1.9.40. YAGNI rule: do not add a second button unless there is an actual caller in existing UI.

If reusing existing report download, package a top-level object whose `support` member is sanitized and whose existing Apply report remains available exactly as before; never inject private receipts into it.

- [ ] **Step 5: Run privacy + report regressions**

```bash
node tests/support-report-sanitization.mjs && node tests/apply-report-opt-in.mjs && node tests/docs.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tessa-matrix-studio.user.js tests/support-report-sanitization.mjs package.json
git commit -m "security: sanitize support diagnostics"
```

---

### Task 8: Release Docs, Full Verification and Live v1.9.40 Gate

**Files:**
- Modify: `README.md`.
- Modify: `docs/PRODUCTION-RUNBOOK.md`.
- Modify: `docs/UAT-COMPACT-ALL-CASES.md`.
- Modify: `CHANGELOG.md`.
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`.
- Modify: `tessa-matrix-studio.user.js` version metadata / `APP.version`.
- Modify: `package.json` version/test list.

**Interfaces:**
- Documentation and release metadata must exactly match implemented behavior.

- [ ] **Step 1: Update end-user docs**

README must explain only user-facing concepts:

- `Среда: готова / ограничена / несовместима`;
- optional limitations block only dependent operations;
- after Apply, `Проверить результат` is read-only;
- `Запись завершена` and `Проверка результата` are separate states;
- mismatch never triggers automatic repair.

Do not expose webpack module IDs or internal object names in the main README.

- [ ] **Step 2: Update Production Runbook**

Document exact capability scopes, receipt lifetime, reconciliation status meanings, retry policy `3 attempts / 450ms / 900ms`, membership-based DELETE verification and privacy whitelist.

- [ ] **Step 3: Extend Compact UAT**

Add manual cases:

```text
CAP-01 ready environment
CAP-02 no local view refresh => limited, Apply still allowed
CAP-03 no CardNew => ADD blocked, UPDATE-only Apply allowed
REC-01 one safe UPDATE => verified
REC-02 one safe ADD => verified by exact created identity
REC-03 safe DELETE test copy => target absent from current membership
REC-04 mutate same row after Apply before check => divergent, no auto-write
REC-05 transient writer-lock => bounded retry/manual retry
PRIV-01 downloaded support diagnostic contains no business row values
```

- [ ] **Step 4: Bump release metadata consistently to `1.9.40`**

Update userscript `@version`, `APP.version`, package version, README, changelog and issue template only after Tasks 1–7 are green.

- [ ] **Step 5: Run docs/release contracts**

```bash
node tests/docs.mjs && node tests/release-workflow.mjs && node tests/workflow-security.mjs
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
npm test
```

Expected: every existing and new regression PASS, including syntax, planner/preflight/race/delete/batch/XLSX security/load/high-cardinality and v1.9.40 capability/reconciliation tests.

- [ ] **Step 7: Review final diff against invariants**

Verify manually:

- no mutation call inside `probeRuntimeEnvironment`, reconciliation engine or reconciliation button handler except existing TessaBridge read methods;
- no `editor.refreshCard()` added;
- no private receipts in `APP.lastReport` / downloadable Apply JSON;
- no display-only matching for reconciliation;
- no `.find()` per receipt over full snapshot;
- current Preview remains consumed after reconciliation;
- v1.9.39 native-view refresh behavior is unchanged except capability status around it.

- [ ] **Step 8: Open draft PR against integrated v1.9.39/main and inspect CI**

PR body must include exact head SHA, full Tests/CodeQL evidence and state that runtime self-check/reconciliation are read-only.

- [ ] **Step 9: Controlled live v1.9.40 UAT**

On a safe test matrix:

1. confirm `Среда: готова` or explain a deliberate `limited` capability;
2. apply exactly one safe UPDATE or ADD, no DELETE on first pass;
3. confirm Apply completes normally and Preview is consumed;
4. click **Проверить результат**;
5. confirm `verified=1`, no Store/Delete network action is triggered by the check;
6. download fresh Excel and reconcile the same row manually once;
7. on a separate test copy, deliberately change the same row after Apply and before `Проверить результат`; expect `divergent=1` and zero automatic mutation;
8. verify optional support diagnostic contains counts/reason codes but no business values.

- [ ] **Step 10: Commit release/docs**

```bash
git add README.md docs/PRODUCTION-RUNBOOK.md docs/UAT-COMPACT-ALL-CASES.md CHANGELOG.md .github/ISSUE_TEMPLATE/bug_report.yml tessa-matrix-studio.user.js package.json
git commit -m "release: prepare v1.9.40 reconciliation hardening"
```

Do not merge/release until exact-head Tests + CodeQL and controlled live v1.9.40 UAT are green.

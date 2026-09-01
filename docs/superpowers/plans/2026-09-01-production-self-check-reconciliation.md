# Production Self-Check + Post-Apply Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в TESSA Matrix Studio read-only self-check совместимости текущей web-сборки TESSA и явную post-Apply сверку фактического состояния затронутых строк без повторной записи, rollback или восстановления погашенного Preview.

**Architecture:** Остаёмся в одном dependency-free userscript. Capability model и reconciliation engine — чистые функции; TessaBridge только обнаруживает runtime primitives и делает fresh read. Успешные mutation receipts хранятся только в памяти вкладки, а reconciliation сравнивает стабильные RowCardID/MatrixVersionID и typed ID-first semantic state из `values`/`roles`, а не display-only `flat`.

**Tech Stack:** JavaScript userscript (`@grant none`), Node.js regressions, GitHub Actions, CodeQL.

**Spec:** `docs/superpowers/specs/2026-09-01-production-self-check-reconciliation-design.md`

## Global Constraints

- Runtime-реализация начинается только после controlled live-gate PR #49 и интеграции/явного supersede v1.9.39.
- Self-check и reconciliation строго read-only: никаких `CardNew`, `CardStore`, `DeleteRow`, `ValidateDuplicate`, rollback/repair.
- Никакого `editor.refreshCard()` для self-check/reconciliation.
- Никакого обхода прав TESSA.
- Capability gating plan-specific: отсутствие `CardNew` блокирует ADD, но не UPDATE-only Apply; отсутствие local view refresh не блокирует Store.
- Текущий snapshot path требует нативный matrix view с `MatrixRowID/MatrixVersionID`; отсутствие самого view блокирует snapshot-dependent export/analyze/apply/reconcile.
- Apply-result остаётся immutable historical receipt. Reconciliation-result — отдельное более позднее наблюдение.
- Любая начавшаяся mutation permanently consumes текущий Preview; reconciliation не делает его применимым снова.
- UPDATE/ADD identity ambiguity => `unknown`, never guessed semantic nearest-match.
- DELETE verified только если target RowCardID и target MatrixVersionID отсутствуют в текущем membership snapshot; физическое наличие исторической row-card в storage не проверяется.
- Default support diagnostics строятся whitelist-ом и не содержат arbitrary `error.message`, business values, workbook/snapshot или private mutation receipts.
- Roundtrip V6, XLSX security ceilings, DELETE/batch guards, preflight и store-time race guards не ослабляются.

## File Map

- `tessa-matrix-studio.user.js` — capability model/probe, APP state, mutation receipts, reconciliation engine, bridge read adapter, UI.
- `tests/runtime-capabilities.mjs` — capability severity + plan-specific operation gating.
- `tests/runtime-capability-probe.mjs` — runtime discovery без server calls.
- `tests/capability-ui-contract.mjs` — status/gating UI.
- `tests/mutation-receipts.mjs` — private successful-write receipts.
- `tests/reconciliation.mjs` — UPDATE/ADD/DELETE semantic verification.
- `tests/reconciliation-writer-lock.mjs` — bounded retry только transient writer-lock.
- `tests/reconciliation-performance.mjs` — 20k snapshot / 500 receipts, linear lookup.
- `tests/reconciliation-ui-contract.mjs` — consumed Preview + explicit check.
- `tests/support-report-sanitization.mjs` — privacy whitelist.
- `package.json`, `README.md`, `docs/PRODUCTION-RUNBOOK.md`, `docs/UAT-COMPACT-ALL-CASES.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/bug_report.yml` — regression/release/docs contracts.

---

### Task 1: Pure Capability Model and Plan-Specific Availability

**Files:**
- Modify: `tessa-matrix-studio.user.js` near existing safety pure helpers.
- Create: `tests/runtime-capabilities.mjs`.
- Modify: `package.json`.

**Interfaces:**
- `evaluateRuntimeCapabilities(probe)` → `{ overall, blockers, warnings, ...probe }`.
- `capabilityOperationAvailability(capabilities, actions=[])` → `{export, analyze, apply, refreshView, reconcile}`.
- `humanCapabilityBlocker(codes)` → Russian user text; stable reason codes remain separate.

Capability probe shape:

```js
{
  runtime: { extensionRequire, apiLoader, workspace, editor, cardModel },
  cardService: { get, request, store, newOrCreate },
  constructors: { cardGetRequest, cardRequest, cardStoreRequest, cardNewRequest, affectVersion },
  matrix: { identity, template, stateReadable, writableState, matrixId },
  nativeView: { found, paging, refresh },
}
```

- [ ] **Step 1: Write RED regression**

Create the same VM harness used by existing tests, then assert:

```js
const readyProbe = {
  runtime: { extensionRequire: true, apiLoader: true, workspace: true, editor: true, cardModel: true },
  cardService: { get: true, request: true, store: true, newOrCreate: true },
  constructors: { cardGetRequest: true, cardRequest: true, cardStoreRequest: true, cardNewRequest: true, affectVersion: true },
  matrix: { identity: true, template: true, stateReadable: true, writableState: true, matrixId: 'matrix-1' },
  nativeView: { found: true, paging: true, refresh: true },
};

const ready = E.evaluateRuntimeCapabilities(readyProbe);
assert(ready.overall === 'ready', JSON.stringify(ready));
assert(E.capabilityOperationAvailability(ready, [{ type: 'update' }]).apply.enabled === true, 'ready UPDATE must apply');

const noCreate = E.evaluateRuntimeCapabilities({ ...readyProbe, cardService: { ...readyProbe.cardService, newOrCreate: false } });
assert(noCreate.overall === 'limited', JSON.stringify(noCreate));
assert(E.capabilityOperationAvailability(noCreate, [{ type: 'update' }]).apply.enabled === true, 'CardNew absence must not block UPDATE-only Apply');
assert(E.capabilityOperationAvailability(noCreate, [{ type: 'add' }]).apply.enabled === false, 'CardNew absence must block ADD');

const noRefresh = E.evaluateRuntimeCapabilities({ ...readyProbe, nativeView: { found: true, paging: true, refresh: false } });
assert(noRefresh.overall === 'limited', JSON.stringify(noRefresh));
assert(E.capabilityOperationAvailability(noRefresh, [{ type: 'update' }]).apply.enabled === true, 'refresh is optional for Store');
assert(E.capabilityOperationAvailability(noRefresh, []).refreshView.enabled === false, 'refreshView must be disabled');

const noView = E.evaluateRuntimeCapabilities({ ...readyProbe, nativeView: { found: false, paging: false, refresh: false } });
assert(noView.overall === 'incompatible', JSON.stringify(noView));
assert(E.capabilityOperationAvailability(noView, []).analyze.enabled === false, 'snapshot-dependent analyze must fail closed');
```

- [ ] **Step 2: Run RED**

```bash
node tests/runtime-capabilities.mjs
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement severity model**

Use critical read-path failures as blockers and missing optional/write capabilities as warnings:

```js
function evaluateRuntimeCapabilities(probe = {}) {
  const blockers = [];
  const warnings = [];
  const block = (code, scope) => blockers.push({ code, scope });
  const warn = (code, scope) => warnings.push({ code, scope });

  if (!probe.runtime?.extensionRequire) block('runtime-extension-require-missing', 'snapshot');
  if (!probe.runtime?.apiLoader) block('runtime-api-loader-missing', 'workspace');
  if (!probe.runtime?.workspace) block('workspace-missing', 'card');
  if (!probe.runtime?.editor) block('editor-missing', 'card');
  if (!probe.runtime?.cardModel) block('card-model-missing', 'card');
  if (!probe.cardService?.get || !probe.constructors?.cardGetRequest) block('card-get-missing', 'read');
  if (!probe.cardService?.request || !probe.constructors?.cardRequest) block('card-request-missing', 'read');
  if (!probe.matrix?.identity || !probe.matrix?.template || !probe.matrix?.stateReadable) block('matrix-identity-unavailable', 'matrix');
  if (!probe.nativeView?.found) block('native-view-missing', 'snapshot');

  if (!probe.cardService?.store || !probe.constructors?.cardStoreRequest || !probe.constructors?.affectVersion) warn('update-store-unavailable', 'apply-update');
  if (!probe.cardService?.newOrCreate || !probe.constructors?.cardNewRequest) warn('add-create-unavailable', 'apply-add');
  if (probe.nativeView?.found && !probe.nativeView?.refresh) warn('native-view-refresh-unavailable', 'refreshView');

  return { ...probe, blockers, warnings, overall: blockers.length ? 'incompatible' : warnings.length ? 'limited' : 'ready' };
}
```

- [ ] **Step 4: Implement exact operation gating**

```js
function capabilityOperationAvailability(cap, actions = []) {
  const types = new Set((actions || []).map(x => x?.type).filter(Boolean));
  const readBlocked = (cap?.blockers || []).some(x => ['snapshot', 'workspace', 'card', 'read', 'matrix'].includes(x.scope));
  const applyBlockers = [];
  if (readBlocked) applyBlockers.push('snapshot-read-unavailable');
  if (!cap?.matrix?.writableState) applyBlockers.push('matrix-not-writable');
  if (types.has('update') && (!cap?.cardService?.store || !cap?.constructors?.cardStoreRequest || !cap?.constructors?.affectVersion)) applyBlockers.push('update-store-unavailable');
  if (types.has('add') && (!cap?.cardService?.store || !cap?.cardService?.newOrCreate || !cap?.constructors?.cardStoreRequest || !cap?.constructors?.cardNewRequest || !cap?.constructors?.affectVersion)) applyBlockers.push('add-store-unavailable');
  if (types.has('delete') && (!cap?.cardService?.request || !cap?.constructors?.cardRequest)) applyBlockers.push('delete-request-unavailable');
  const read = { enabled: !readBlocked, blockers: readBlocked ? ['snapshot-read-unavailable'] : [] };
  return {
    export: { ...read },
    analyze: { ...read },
    apply: { enabled: applyBlockers.length === 0, blockers: applyBlockers },
    refreshView: { enabled: Boolean(cap?.nativeView?.found && cap?.nativeView?.refresh), blockers: cap?.nativeView?.refresh ? [] : ['native-view-refresh-unavailable'] },
    reconcile: { ...read },
  };
}
```

Define user messages explicitly:

```js
const CAPABILITY_MESSAGES = Object.freeze({
  'snapshot-read-unavailable': 'Текущая сборка TESSA не позволяет безопасно прочитать строки матрицы.',
  'matrix-not-writable': 'Матрица сейчас не находится в состоянии, допускающем изменение.',
  'update-store-unavailable': 'В этой сборке TESSA недоступно безопасное изменение существующих строк.',
  'add-store-unavailable': 'В этой сборке TESSA недоступно безопасное добавление новых строк.',
  'delete-request-unavailable': 'В этой сборке TESSA недоступно штатное удаление строки матрицы.',
  'native-view-refresh-unavailable': 'Автоматическое обновление отображения недоступно; запись при этом может работать.',
});
function humanCapabilityBlocker(codes = []) {
  return [...new Set(codes)].map(code => CAPABILITY_MESSAGES[code] || `Недоступна возможность TESSA: ${code}`).join(' ');
}
```

- [ ] **Step 5: Export helpers, add test to `npm test`, run focused suite**

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

### Task 2: Safe Runtime Probe + Capability UI

**Files:**
- Modify: `tessa-matrix-studio.user.js` around `captureExtensionRequire()`, `TessaBridge`, APP state and panel UI.
- Create: `tests/runtime-capability-probe.mjs`.
- Create: `tests/capability-ui-contract.mjs`.
- Modify: `package.json`.

**Interfaces:**
- `probeRuntimeEnvironment({root, extensionRequireFactory}={})` → Task 1 probe shape; no server calls.
- `inspectNativeViewCapabilitiesReadOnly(editor, typedField)` → `{found,paging,refresh}`.
- `inspectMatrixCapabilitiesReadOnly(mainCard, typedField)` → `{identity,template,stateReadable,writableState,matrixId}`.
- `capabilityStatusModel(cap, availability)` → UI model.
- APP fields: `capabilities`, `capabilityAvailability`, `capabilityCheckedCardId`.

- [ ] **Step 1: Write RED no-mutation probe test**

Inject a fake `CardService` whose methods append to `calls`. Call only `probeRuntimeEnvironment()` and assert `calls.length === 0`.

```js
const calls = [];
const fakeService = {
  get() { calls.push('get'); }, request() { calls.push('request'); }, store() { calls.push('store'); }, new() { calls.push('new'); },
};
const fakeCards = {
  CardGetRequest: class {}, CardRequest: class {}, CardNewRequest: class {},
  CardStoreRequest: class { get affectVersion() { return false; } set affectVersion(value) { this._affectVersion = value; } },
};
const fakeRequire = id => id === 9855 ? fakeCards : id === 9893 ? { CardService: { instance: fakeService } } : {};
const fakeCard = {
  id: '11111111-1111-1111-1111-111111111111',
  sections: { tryGet: name => name === 'MtxRouteMatrix' ? { fields: { tryGetString: key => key === 'TemplateID' ? '22222222-2222-2222-2222-222222222222' : key === 'StateName' ? 'Черновик' : null } } : null },
};
const fakeControl = { table: { rows: [{ data: new Map([['MatrixRowID', '33333333-3333-3333-3333-333333333333'], ['MatrixVersionID', '44444444-4444-4444-4444-444444444444']]) }] }, refresh() {}, setPageAndRefresh() {} };
const fakeRoot = { tessa: { apiLoader: () => ({ WorkspaceStorage: { instance: { currentCardWorkspace: { editor: { cardModel: { card: fakeCard, controls: new Map([['TestMatrixView', fakeControl]]) } } } } } }) } };
const probe = E.probeRuntimeEnvironment({ root: fakeRoot, extensionRequireFactory: () => fakeRequire });
assert(probe.cardService.newOrCreate === true, JSON.stringify(probe));
assert(probe.nativeView.found === true, JSON.stringify(probe));
assert(calls.length === 0, `probe called server methods: ${calls}`);
```

Also assert missing/throwing `apiLoader` and extension require produce booleans instead of an uncaught exception.

- [ ] **Step 2: Run RED**

```bash
node tests/runtime-capability-probe.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement all read-only probe helpers (no undefined dependencies)**

```js
function probeDataValue(data, key, typedField = null) {
  if (!data) return null;
  try { if (typeof data.get === 'function') { const value = data.get(key); if (value !== undefined && value !== null) return value; } } catch (_) {}
  try { if (typeof data.tryGet === 'function') { const value = data.tryGet(key); return typedField?.get ? typedField.get(value) : value; } } catch (_) {}
  return data[key] ?? null;
}

function probeControlEntries(editor) {
  const controls = editor?.cardModel?.controls;
  if (!controls) return [];
  try { if (typeof controls.entries === 'function') return Array.from(controls.entries()); } catch (_) {}
  if (Array.isArray(controls)) return controls.map((value, index) => [String(index), value]);
  return Object.entries(controls);
}

function probeControlRows(control) {
  for (const candidate of [control, control?.control, control?.model, control?.viewModel]) {
    try { if (candidate?.table?.rows) return Array.from(candidate.table.rows); } catch (_) {}
  }
  return [];
}

function inspectNativeViewCapabilitiesReadOnly(editor, typedField = null) {
  for (const [, original] of probeControlEntries(editor)) {
    const rows = probeControlRows(original);
    const valid = rows.some(row => {
      const data = row?.data || row?.selectedObject;
      return probeDataValue(data, 'MatrixRowID', typedField) && probeDataValue(data, 'MatrixVersionID', typedField);
    });
    if (!valid) continue;
    const target = [original, original?.control, original?.model, original?.viewModel].find(Boolean);
    const component = target?.viewComponent || target?.component || target;
    return {
      found: true,
      paging: typeof target?.setPageAndRefresh === 'function' || Number.isFinite(Number(component?.currentPage ?? component?._currentPage)),
      refresh: typeof target?.refresh === 'function' || typeof target?.viewComponent?.refresh === 'function' || typeof target?.setPageAndRefresh === 'function',
    };
  }
  return { found: false, paging: false, refresh: false };
}

function probeFieldValue(section, name, typedField = null) {
  const fields = section?.fields;
  if (!fields) return null;
  for (const method of ['tryGetString', 'tryGetGuid', 'tryGetNumber', 'tryGetBoolean', 'tryGetDateTime']) {
    try { const value = fields[method]?.(name); if (value !== undefined && value !== null) return value; } catch (_) {}
  }
  try { const value = fields.tryGet?.(name); return typedField?.get ? typedField.get(value) : value; } catch (_) { return null; }
}

function inspectMatrixCapabilitiesReadOnly(mainCard, typedField = null) {
  const section = mainCard?.sections?.tryGet?.(S.Matrix) || null;
  const template = probeFieldValue(section, F.TemplateID, typedField);
  const stateName = probeFieldValue(section, 'StateName', typedField);
  const stateCaption = matrixStateCaption(stateName);
  return {
    identity: Boolean(mainCard?.id),
    template: Boolean(template),
    stateReadable: Boolean(stateName),
    writableState: canonicalValue(stateCaption) === canonicalValue('Черновик'),
    matrixId: mainCard?.id ? String(mainCard.id) : null,
  };
}

function probeRuntimeEnvironment(options = {}) {
  const root = options.root || window;
  const extensionRequireFactory = options.extensionRequireFactory || captureExtensionRequire;
  let extRequire = null, cards = null, core = null, cardService = null;
  try {
    extRequire = extensionRequireFactory();
    cards = extRequire?.(9855) || null;
    core = extRequire?.(9814) || null;
    cardService = extRequire?.(9893)?.CardService?.instance || null;
  } catch (_) {}
  const apiLoader = typeof root?.tessa?.apiLoader === 'function' ? root.tessa.apiLoader : null;
  let workspace = null;
  try { workspace = apiLoader?.(546914)?.WorkspaceStorage?.instance?.currentCardWorkspace || null; } catch (_) {}
  const editor = workspace?.editor || null;
  const cardModel = editor?.cardModel || null;
  const mainCard = cardModel?.card || null;
  const storeProto = cards?.CardStoreRequest?.prototype || null;
  const affectVersion = Boolean(storeProto && ('affectVersion' in storeProto || Object.getOwnPropertyDescriptor(storeProto, 'affectVersion')));
  return {
    runtime: { extensionRequire: Boolean(extRequire), apiLoader: Boolean(apiLoader), workspace: Boolean(workspace), editor: Boolean(editor), cardModel: Boolean(cardModel) },
    cardService: { get: typeof cardService?.get === 'function', request: typeof cardService?.request === 'function', store: typeof cardService?.store === 'function', newOrCreate: typeof cardService?.new === 'function' || typeof cardService?.create === 'function' },
    constructors: { cardGetRequest: typeof cards?.CardGetRequest === 'function', cardRequest: typeof cards?.CardRequest === 'function', cardStoreRequest: typeof cards?.CardStoreRequest === 'function', cardNewRequest: typeof cards?.CardNewRequest === 'function', affectVersion },
    matrix: inspectMatrixCapabilitiesReadOnly(mainCard, core?.TypedField || null),
    nativeView: inspectNativeViewCapabilitiesReadOnly(editor, core?.TypedField || null),
  };
}
```

If real bundled `CardStoreRequest.prototype` cannot prove `affectVersion` although the existing runtime setter works, make the probe proof `typeof new cards.CardStoreRequest() === 'object' && 'affectVersion' in instance`; construction is local-only and must be covered by the no-server-call test.

- [ ] **Step 4: Write RED UI contract**

`tests/capability-ui-contract.mjs` asserts `#tms-capability-status`, `#tms-capability-details`, `Повторить проверку`, and exported `capabilityStatusModel()`.

```js
const model = E.capabilityStatusModel({ overall: 'limited', blockers: [], warnings: [{ code: 'native-view-refresh-unavailable' }] }, {
  apply: { enabled: true, blockers: [] }, refreshView: { enabled: false, blockers: ['native-view-refresh-unavailable'] }, export: { enabled: true }, analyze: { enabled: true }, reconcile: { enabled: true },
});
assert(model.label === 'Среда: ограничена', JSON.stringify(model));
assert(model.applyEnabled === true, JSON.stringify(model));
```

- [ ] **Step 5: Implement APP/UI wiring**

Add APP fields:

```js
capabilities: null,
capabilityAvailability: null,
capabilityCheckedCardId: null,
lastMutationReceipts: null,
lastReconciliation: null,
```

Define:

```js
function capabilityStatusModel(cap, availability) {
  return {
    label: cap?.overall === 'ready' ? 'Среда: готова' : cap?.overall === 'limited' ? 'Среда: ограничена' : 'Среда: несовместима',
    applyEnabled: Boolean(availability?.apply?.enabled),
    exportEnabled: Boolean(availability?.export?.enabled),
    analyzeEnabled: Boolean(availability?.analyze?.enabled),
    reconcileEnabled: Boolean(availability?.reconcile?.enabled),
    codes: [...(cap?.blockers || []), ...(cap?.warnings || [])].map(x => x.code),
  };
}

function refreshRuntimeCapabilities(actions = []) {
  APP.capabilities = evaluateRuntimeCapabilities(probeRuntimeEnvironment());
  APP.capabilityAvailability = capabilityOperationAvailability(APP.capabilities, actions);
  APP.capabilityCheckedCardId = APP.capabilities?.matrix?.matrixId || null;
  renderCapabilityStatus(capabilityStatusModel(APP.capabilities, APP.capabilityAvailability));
  return APP.capabilityAvailability;
}

function renderCapabilityStatus(model) {
  const host = document.querySelector?.('#tms-capability-status');
  const details = document.querySelector?.('#tms-capability-details');
  if (host) host.textContent = model.label;
  if (details) details.textContent = model.codes.map(code => CAPABILITY_MESSAGES[code] || code).join(' ');
}
```

Panel markup adds a compact status/details and a button `id="tms-capability-recheck"` labelled `Повторить проверку`.

Before download/analyze call `refreshRuntimeCapabilities([])` and block only if that operation is disabled. Before Apply build reviewed plan first and pass its executable action types to `refreshRuntimeCapabilities(actions)`; then keep all existing preflight/state/native-edit/delete/batch checks unchanged.

- [ ] **Step 6: Run focused tests**

```bash
node tests/runtime-capability-probe.mjs && node tests/capability-ui-contract.mjs && node tests/runtime-capabilities.mjs && node tests/review-ui-contract.mjs && node tests/acceptance.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tessa-matrix-studio.user.js tests/runtime-capability-probe.mjs tests/capability-ui-contract.mjs package.json
git commit -m "feat: surface TESSA compatibility status"
```

---

### Task 3: Private Mutation Receipts + ID-First Semantic Key

**Files:**
- Modify: `tessa-matrix-studio.user.js` around semantic helpers and `applyPlan()` loops.
- Create: `tests/mutation-receipts.mjs`.
- Modify: `package.json`.

**Interfaces:**
- `reconciliationSemanticKey(row, structure)` → stable hash from `values`/`roles`.
- `createMutationReceipt({type, action, rowCardId, versionId, expectedRow, structure})`.
- `APP.lastMutationReceipts = {planId,matrixId,templateId,receipts,createdAt}` session-only.

Receipt:

```js
{ type: 'update'|'add'|'delete', excelRow: number|null, rowCardId: string|null, versionId: string|null, expectedSemanticKey: string|null }
```

- [ ] **Step 1: Write RED semantic tests**

Use two rows with the same ReferenceGuid/Role IDs but different display names; their semantic keys must match. Change only ID; keys must differ. Reverse multivalue item order; keys must match. Change Boolean/range; keys must differ.

- [ ] **Step 2: Run RED**

```bash
node tests/mutation-receipts.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement semantic serialization**

```js
function reconciliationCriterionToken(item) {
  if (item?.id !== null && item?.id !== undefined && item?.id !== '') return `ref:${canonicalValue(item.id)}`;
  const kind = canonicalValue(item?.kind || 'string');
  if (kind === 'boolean') return `bool:${item?.value ? 1 : 0}`;
  if (kind === 'int' || kind === 'decimal' || kind === 'date' || kind === 'datetime') {
    const value = normalizeSpace(item?.value ?? item?.display ?? '');
    const to = item?.to === null || item?.to === undefined ? '' : normalizeSpace(item.to);
    return `${kind}:${canonicalValue(value)}:${canonicalValue(to)}`;
  }
  return `text:${canonicalValue(item?.value ?? item?.display ?? '')}`;
}

function reconciliationSemanticKey(row, structure) {
  const parts = [];
  for (const condition of [...(structure?.conditions || [])].sort((a,b) => canonicalValue(a.criterionRowId).localeCompare(canonicalValue(b.criterionRowId)))) {
    const tokens = (row?.values?.[condition.criterionRowId] || []).map(reconciliationCriterionToken).sort();
    parts.push(`c:${canonicalValue(condition.criterionRowId)}=[${tokens.join(',')}]`);
  }
  for (const fn of [...(structure?.functions || [])].sort((a,b) => canonicalValue(a.id).localeCompare(canonicalValue(b.id)))) {
    const tokens = (row?.roles?.[fn.id] || []).map(item => `role:${canonicalValue(item.id)}:${canonicalValue(item.roleTypeId)}`).sort();
    parts.push(`f:${canonicalValue(fn.id)}=[${tokens.join(',')}]`);
  }
  return hashText(parts.join('|'));
}
```

Before final implementation, replace numeric/date normalization above with the repository’s existing typed semantic helper if its signature can represent the same values; do not create two competing date/decimal parsers.

- [ ] **Step 4: Implement receipt factory**

```js
function createMutationReceipt({ type, action, rowCardId, versionId, expectedRow, structure }) {
  return {
    type,
    excelRow: Number.isFinite(Number(action?.excelRow?.excelRow)) ? Number(action.excelRow.excelRow) : null,
    rowCardId: rowCardId ? String(rowCardId) : null,
    versionId: versionId ? String(versionId) : null,
    expectedSemanticKey: type === 'delete' ? null : reconciliationSemanticKey(expectedRow, structure),
  };
}
```

- [ ] **Step 5: Capture receipts only after successful mutations**

Initialize `const receipts=[]` in `applyPlan()` after successful preflight.

For UPDATE and ADD, before Store derive `expectedRow` from the already rebuilt local card using existing `bridge.readMatrixRowFromCard(...)`; after successful Store append receipt. For DELETE append after successful `deleteMatrixRow()` using both `prepared.current.rowCardId` and `prepared.current.versionId`.

At Apply completion:

```js
APP.lastMutationReceipts = result.startedCount > 0 ? {
  planId: plan.id,
  matrixId: plan.matrixId,
  templateId: structure.templateId,
  receipts,
  createdAt: nowIso(),
} : null;
```

Do not add `receipts` or `expectedSemanticKey` to `result`, `result.rows` or `APP.lastReport`.

- [ ] **Step 6: Assert skipped writes produce no receipt and report stays clean**

```js
assert(APP.lastMutationReceipts.receipts.length === successfulStoreCount, JSON.stringify(APP.lastMutationReceipts));
assert(!JSON.stringify(APP.lastReport).includes('expectedSemanticKey'), 'private semantic receipt leaked into Apply report');
```

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

### Task 4: Reconciliation Engine, Fresh Read Retry and Performance

**Files:**
- Modify: `tessa-matrix-studio.user.js`.
- Create: `tests/reconciliation.mjs`.
- Create: `tests/reconciliation-writer-lock.mjs`.
- Create: `tests/reconciliation-performance.mjs`.
- Modify: `package.json`.

**Interfaces:**
- `indexSnapshotForReconciliation(snapshot)` → `{byCard,byVersion,rowCount}`.
- `reconcileMutationReceipts(receipts,snapshot,structure)` → reconciliation result.
- `runReconciliationRead(bridgeFactory,receiptContext,options={})` → fresh read + bounded retry.

- [ ] **Step 1: Write RED reconciliation matrix**

Cover:

1. UPDATE exact RowCardID + semantic key → `verified`.
2. UPDATE same identity, changed semantic → `divergent`.
3. UPDATE identity absent → row `missing`, overall `divergent`.
4. ADD exact created identity + semantic → `verified`.
5. ADD receipt without provable identity → `unknown`, never semantic nearest-match.
6. DELETE both target IDs absent from fresh membership → `verified`.
7. DELETE VersionID absent but same RowCardID present with another version → `divergent`.
8. one divergent among 100 verified → exact counts.
9. unknown without divergence → overall `incomplete`.

- [ ] **Step 2: Run RED**

```bash
node tests/reconciliation.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement indexes and strict rules**

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

function reconcileMutationReceipts(receipts, snapshot, structure) {
  const index = indexSnapshotForReconciliation(snapshot);
  const rows = [];
  for (const receipt of receipts || []) {
    const byCard = receipt.rowCardId ? index.byCard.get(canonicalValue(receipt.rowCardId)) : null;
    const byVersion = receipt.versionId ? index.byVersion.get(canonicalValue(receipt.versionId)) : null;
    if (receipt.type === 'delete') {
      rows.push(byCard || byVersion
        ? { type: 'delete', excelRow: receipt.excelRow, status: 'divergent', reasonCode: 'reconcile-delete-still-member' }
        : { type: 'delete', excelRow: receipt.excelRow, status: 'verified', reasonCode: 'reconcile-delete-absent' });
      continue;
    }
    if (!receipt.rowCardId && !receipt.versionId) {
      rows.push({ type: receipt.type, excelRow: receipt.excelRow, status: 'unknown', reasonCode: 'reconcile-identity-unknown' });
      continue;
    }
    const current = byCard || byVersion;
    if (!current) {
      rows.push({ type: receipt.type, excelRow: receipt.excelRow, status: 'missing', reasonCode: 'reconcile-target-missing' });
      continue;
    }
    rows.push(reconciliationSemanticKey(current, structure) === receipt.expectedSemanticKey
      ? { type: receipt.type, excelRow: receipt.excelRow, status: 'verified', reasonCode: 'reconcile-match' }
      : { type: receipt.type, excelRow: receipt.excelRow, status: 'divergent', reasonCode: 'reconcile-semantic-divergence' });
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

- [ ] **Step 4: Write RED writer-lock test**

Bridge factory succeeds, but `loadSnapshot()` throws `MatrixRow.WriteHeartbit ObtainWriterLock` twice and succeeds third time. Assert exactly 3 attempts. For `permission denied`, assert exactly 1 attempt and `retryable=false`.

- [ ] **Step 5: Implement fresh orchestration**

```js
async function runReconciliationRead(bridgeFactory, receiptContext, options = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 450));
  const startedAt = nowIso();
  let lastError = null;
  let usedAttempts = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    usedAttempts = attempt;
    if (attempt > 1 && baseDelayMs) await sleep(baseDelayMs * (2 ** (attempt - 2)));
    try {
      const bridge = await bridgeFactory();
      const structure = await bridge.requestStructure(receiptContext.templateId);
      const snapshot = await bridge.loadSnapshot(structure);
      if (canonicalValue(snapshot.matrixId) !== canonicalValue(receiptContext.matrixId)) throw new Error('reconcile-matrix-changed');
      return { ...reconcileMutationReceipts(receiptContext.receipts, snapshot, structure), attempts: attempt, retryable: false, startedAt, finishedAt: nowIso() };
    } catch (error) {
      lastError = error;
      if (!isWriterLockError(error) || attempt === maxAttempts) break;
    }
  }
  const retryable = isWriterLockError(lastError);
  return {
    status: 'incomplete', checkedCount: 0, verifiedCount: 0, divergentCount: 0, missingCount: 0,
    unknownCount: receiptContext?.receipts?.length || 0, rows: [], attempts: usedAttempts, retryable,
    reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed', startedAt, finishedAt: nowIso(),
  };
}
```

Do not include `lastError.message` in the returned result.

- [ ] **Step 6: Add performance regression**

Generate deterministic 20,000-row snapshot + 500 receipts; all must verify. Broad CI ceiling for pure reconciliation: `< 2000 ms`. Assert source of `reconcileMutationReceipts` contains `indexSnapshotForReconciliation` and does not call `(snapshot.rows || []).find` inside receipt processing.

- [ ] **Step 7: Run focused suite**

```bash
node tests/reconciliation.mjs && node tests/reconciliation-writer-lock.mjs && node tests/reconciliation-performance.mjs && node tests/xlsx-load.mjs && node tests/dictionary-high-cardinality.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tessa-matrix-studio.user.js tests/reconciliation.mjs tests/reconciliation-writer-lock.mjs tests/reconciliation-performance.mjs package.json
git commit -m "feat: reconcile applied mutations read-only"
```

---

### Task 5: Explicit Reconciliation UI + Privacy-Safe Support Report

**Files:**
- Modify: `tessa-matrix-studio.user.js` `renderPlanConsumedNotice()`, panel markup/styles/handlers and report helpers.
- Create: `tests/reconciliation-ui-contract.mjs`.
- Create: `tests/support-report-sanitization.mjs`.
- Modify: `package.json`.

**Interfaces:**
- `reconciliationSummary(result)` → short user text.
- `renderReconciliationResult(result)` → DOM only.
- `sanitizeSupportReport(input,{includeIds=false}={})` → explicit whitelist.
- APP: `lastReconciliation`.

- [ ] **Step 1: Write RED UI contract**

Assert code contains `id="tms-reconcile"`, label `Проверить результат`, `id="tms-reconciliation-result"` and exported `reconciliationSummary`.

```js
const summary = E.reconciliationSummary({ status: 'divergent', checkedCount: 11, verifiedCount: 10, divergentCount: 1, missingCount: 0, unknownCount: 0 });
assert(/10/.test(summary) && /1/.test(summary), summary);
```

Simulate consumed Apply state, assign `APP.lastReconciliation`, and assert reconciliation never restores `APP.plan` or enables old Apply.

- [ ] **Step 2: Run RED UI test**

```bash
node tests/reconciliation-ui-contract.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement summary/render functions**

```js
function reconciliationSummary(result) {
  if (!result) return 'Проверка результата не выполнялась.';
  if (result.status === 'verified') return `Подтверждено: ${result.verifiedCount} из ${result.checkedCount}.`;
  if (result.status === 'divergent') return `Подтверждено: ${result.verifiedCount}; расхождений: ${result.divergentCount + result.missingCount}.`;
  return `Проверка неполная: подтверждено ${result.verifiedCount || 0}; неизвестно ${result.unknownCount || 0}.`;
}

function renderReconciliationResult(result) {
  const host = document.querySelector?.('#tms-reconciliation-result');
  if (host) host.textContent = reconciliationSummary(result);
}
```

- [ ] **Step 4: Add explicit button/handler**

Markup:

```html
<button id="tms-reconcile" class="tms-ghost" hidden disabled>Проверить результат</button>
<div id="tms-reconciliation-result" class="tms-step-caption"></div>
```

`renderPlanConsumedNotice()` enables it only when `APP.lastMutationReceipts?.receipts?.length > 0` and reconciliation capability is available.

Handler:

```js
panel.querySelector('#tms-reconcile').addEventListener('click', async () => {
  if (APP.busy || !APP.lastMutationReceipts?.receipts?.length) return;
  setBusy(true);
  try {
    const availability = refreshRuntimeCapabilities([]);
    if (!availability.reconcile.enabled) throw new Error(humanCapabilityBlocker(availability.reconcile.blockers));
    setProgress(20, 'Проверяю результат', 'Свежий snapshot TESSA · без записи');
    APP.lastReconciliation = await runReconciliationRead(() => TessaBridge.create(), APP.lastMutationReceipts, { attempts: 3, baseDelayMs: 450 });
    renderReconciliationResult(APP.lastReconciliation);
    setProgress(100, 'Проверка результата завершена', reconciliationSummary(APP.lastReconciliation));
  } catch (error) {
    APP.lastReconciliation = { status: 'incomplete', checkedCount: 0, verifiedCount: 0, divergentCount: 0, missingCount: 0, unknownCount: APP.lastMutationReceipts.receipts.length, retryable: isWriterLockError(error), reasonCode: isWriterLockError(error) ? 'reconcile-writer-lock' : 'reconcile-read-failed' };
    renderReconciliationResult(APP.lastReconciliation);
  } finally { setBusy(false); }
});
```

Do not mutate `APP.lastReport` or historical Apply result from this handler. Keep v1.9.39 `#tms-refresh-view` independent.

- [ ] **Step 5: Write RED privacy test**

```js
const unsafe = {
  version: '1.9.40', matrixId: 'matrix-id', templateId: 'template-id',
  capabilities: { overall: 'limited', blockers: [{ code: 'native-view-refresh-unavailable', scope: 'refreshView' }], warnings: [] },
  apply: { status: 'completed', requestedCount: 1, appliedCount: 1, failedCount: 0, notStartedCount: 0 },
  reconciliation: { status: 'divergent', checkedCount: 1, verifiedCount: 0, divergentCount: 1, missingCount: 0, unknownCount: 0, rows: [{ reasonCode: 'reconcile-semantic-divergence', value: 'СЕКРЕТНЫЙ КОНТРАГЕНТ' }] },
  receipts: [{ expectedSemanticKey: 'PRIVATE-HASH' }], workbook: { rows: ['СЕКРЕТНЫЙ'] }, snapshot: { rows: ['Иванов Иван'] }, error: { message: 'Иванов Иван' }, logs: ['Ромашка'],
};
const safe = E.sanitizeSupportReport(unsafe, { includeIds: false });
const text = JSON.stringify(safe);
for (const forbidden of ['СЕКРЕТНЫЙ', 'Иванов', 'Ромашка', 'PRIVATE-HASH', 'receipts', 'workbook', 'snapshot', 'error']) assert(!text.includes(forbidden), text);
assert(!text.includes('matrix-id') && !text.includes('template-id'), text);
const withIds = E.sanitizeSupportReport(unsafe, { includeIds: true });
assert(withIds.matrixId === 'matrix-id' && withIds.templateId === 'template-id', JSON.stringify(withIds));
```

- [ ] **Step 6: Implement whitelist sanitizer**

```js
function sanitizeSupportReport(input = {}, options = {}) {
  const reconciliation = input.reconciliation || {};
  return {
    studioVersion: String(input.version || APP.version),
    createdAt: nowIso(),
    ...(options.includeIds ? { matrixId: input.matrixId || null, templateId: input.templateId || null } : {}),
    capabilities: {
      overall: input.capabilities?.overall || null,
      blockers: (input.capabilities?.blockers || []).map(x => ({ code: x.code, scope: x.scope })),
      warnings: (input.capabilities?.warnings || []).map(x => ({ code: x.code, scope: x.scope })),
    },
    apply: input.apply ? { status: input.apply.status || null, requestedCount: Number(input.apply.requestedCount || 0), appliedCount: Number(input.apply.appliedCount || 0), failedCount: Number(input.apply.failedCount || 0), notStartedCount: Number(input.apply.notStartedCount || 0) } : null,
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

Do not add a second diagnostic-download button unless an existing support flow actually consumes it; YAGNI. The helper must exist and be testable, while existing Apply JSON remains unchanged and opt-in.

- [ ] **Step 7: Run focused tests**

```bash
node tests/reconciliation-ui-contract.mjs && node tests/support-report-sanitization.mjs && node tests/sticky-progress-ui.mjs && node tests/post-apply-view-refresh.mjs && node tests/apply-plan-consumed.mjs && node tests/apply-report-opt-in.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tessa-matrix-studio.user.js tests/reconciliation-ui-contract.mjs tests/support-report-sanitization.mjs package.json
git commit -m "feat: expose verified post-Apply state"
```

---

### Task 6: Docs, Version 1.9.40, Full Verification and Live Gate

**Files:**
- Modify: `README.md`, `docs/PRODUCTION-RUNBOOK.md`, `docs/UAT-COMPACT-ALL-CASES.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `tessa-matrix-studio.user.js`, `package.json`.

**Interfaces:**
- Release/docs must match exact runtime behavior and reason/status semantics.

- [ ] **Step 1: Update README user contract**

Document only:

- `Среда: готова / ограничена / несовместима`;
- missing optional capability blocks only dependent operations;
- `Проверить результат` is read-only;
- `Запись` and `Проверка результата` are separate facts;
- reconciliation mismatch never triggers automatic repair.

Do not publish webpack module IDs/internal object names in main README.

- [ ] **Step 2: Update Production Runbook**

Document capability scopes, private receipt lifetime, exact reconciliation states, writer-lock policy `3 attempts; 450ms then 900ms`, membership-based DELETE verification, O(N+M) indexing, and diagnostic whitelist.

- [ ] **Step 3: Extend Compact UAT**

Add exact cases:

```text
CAP-01 ready environment
CAP-02 no local view refresh => limited, Apply allowed
CAP-03 no CardNew => ADD blocked, UPDATE-only Apply allowed
REC-01 safe UPDATE => verified
REC-02 safe ADD => verified by exact created identity
REC-03 DELETE test copy => target IDs absent from current membership
REC-04 external change after Apply => divergent, zero auto-write
REC-05 transient writer-lock => bounded retry/manual retry
PRIV-01 sanitized support object contains no business values
```

- [ ] **Step 4: Bump all release surfaces to `1.9.40`**

Only now update userscript `@version`, `APP.version`, package version, README, changelog and issue-template version placeholder.

- [ ] **Step 5: Run docs/release checks**

```bash
node tests/docs.mjs && node tests/release-workflow.mjs && node tests/workflow-security.mjs
```

Expected: PASS.

- [ ] **Step 6: Run full verification**

```bash
npm test
```

Expected: syntax + every existing/new regression PASS, including planner/preflight/races/delete/batch/XLSX security/5000 load/high-cardinality and all capability/reconciliation tests.

- [ ] **Step 7: Manual invariant diff review**

Confirm:

- no server mutation call exists inside `probeRuntimeEnvironment`, `reconcileMutationReceipts`, `runReconciliationRead` or reconciliation UI handler;
- no new `editor.refreshCard()`;
- no private receipt in downloadable Apply JSON;
- no display-only identity matching;
- no per-receipt full-snapshot `.find()` loop;
- reconciliation never restores old `APP.plan`;
- v1.9.39 native-view refresh behavior remains intact.

- [ ] **Step 8: Open draft PR against integrated v1.9.39/main; require exact-head Tests + CodeQL**

PR body states self-check/reconciliation are read-only and includes exact CI run/head SHA.

- [ ] **Step 9: Controlled live v1.9.40 UAT**

On a safe test matrix:

1. confirm environment status;
2. Apply exactly one safe UPDATE or ADD, no DELETE on first pass;
3. confirm Apply completes and old Preview is consumed;
4. click `Проверить результат`;
5. confirm `verified=1` and browser network log contains no new Store/Delete mutation caused by reconciliation;
6. download fresh Excel and manually reconcile the same row once;
7. on a separate test copy, change the same row after Apply but before check; expect `divergent=1`, no automatic repair;
8. run the privacy fixture/explicit support output and confirm no business values.

- [ ] **Step 10: Commit release/docs**

```bash
git add README.md docs/PRODUCTION-RUNBOOK.md docs/UAT-COMPACT-ALL-CASES.md CHANGELOG.md .github/ISSUE_TEMPLATE/bug_report.yml tessa-matrix-studio.user.js package.json
git commit -m "release: prepare v1.9.40 reconciliation hardening"
```

Do not merge/release until exact-head Tests + CodeQL and controlled live v1.9.40 UAT are green.

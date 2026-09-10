# Production-safe Import, Picker and UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit same-template cross-matrix replacement, safe/high-cardinality dictionary editing, production-recordkeeping legal-entity filtering, performance telemetry/optimization, and a reproducible one-button Full UAT ZIP without weakening current TESSA write safety.

**Architecture:** Keep the production distribution as the existing single userscript, but introduce narrow pure helpers and explicit DTO/state contracts inside it so each behavior can be tested independently through `__TESSA_MATRIX_SYNC_EXPORTS__`. Delivery is split into independently releasable PRs: replacement transport, dictionary/picker hardening, performance/filtering, then Full UAT. Runtime writes continue to go through already-proven native TESSA CardService/editor contracts; negative/fault UAT uses scoped adapters instead of destructive server faults.

**Tech Stack:** JavaScript userscript, Node.js regression tests, jsdom UI tests, custom XLSX OPC/ZIP reader/writer, TESSA Web runtime/CardService, GitHub Actions Quality/CodeQL.

**Spec:** `docs/superpowers/specs/2026-09-10-production-safe-import-picker-uat.md`

## Global Constraints

- Finish and live-test PR #93 (`hotfix/xlsx-row-limit`) independently before merging feature work from this plan.
- No VBA, ActiveX, Office add-in or external executable.
- Foreign `TemplateID` remains fail-closed.
- Foreign same-template `MatrixID` requires explicit replacement confirmation before any write.
- Foreign MatrixRowID/MatrixVersionID are never used as CardID/update/delete targets in the opened matrix.
- Replacement target rows are not deleted until the desired replacement set has passed preflight and the ADD phase has succeeded.
- Runtime TESSA objects never cross JSON/cache/XLSX/report DTO boundaries.
- FIO is not unique; stable ID is identity and position is mandatory display disambiguation when available.
- Legal-entity filtering is enabled only when the «Ведение дела производства» flag projection is proven from TESSA data.
- Existing XLSX coordinate/integrity/security guards remain; performance work changes representation/loading, not correctness boundaries.
- Full UAT writes only after explicit confirmation, records a reproducible seed, and always runs cleanup in `finally`.
- Existing exact-artifact native-evidence release gate remains mandatory.
- Every task follows RED → minimal GREEN → focused test → full `npm test` → commit.

---

## Delivery map

**PR A — Cross-matrix replacement:** Tasks 1–4. Safe standalone feature; no picker/UAT dependency.

**PR B — Dictionary/picker hardening:** Tasks 5–9. Fixes circular refresh, employee disambiguation, bulk collection, autocomplete/picker UX.

**PR C — Catalog filtering/performance:** Tasks 10–12. Adds the proven legal-entity filter, telemetry and large-catalog representation optimization.

**PR D — Full UAT Runner:** Tasks 13–17. Adds deterministic live UAT, negative/fault scenarios, cleanup and one ZIP.

**Release readiness:** Task 18.

---

### Task 1: Classify workbook context without silently suppressing same-template transfers

**Files:**
- Modify: `tessa-matrix-studio.user.js` around `evaluatePlanSafety`, `buildPlan`
- Create: `tests/cross-matrix-context.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `classifyWorkbookContext(workbook, matrixInfo) -> { kind, workbookMatrixId, currentMatrixId, workbookTemplateId, currentTemplateId }`
- `kind` is exactly one of `same-matrix`, `previous-version`, `same-template-foreign-matrix`, `foreign-template`, `invalid-roundtrip`.

- [ ] **Step 1: Write the failing context-classification test**

```js
const sameTemplateForeign = E.classifyWorkbookContext(
  { roundtrip: { enabled: true, matrixId: 'm-source', templateId: 't' } },
  { matrixId: 'm-target', PreviousVersionID: 'm-prev', TemplateID: 't' },
);
assert.equal(sameTemplateForeign.kind, 'same-template-foreign-matrix');

const foreignTemplate = E.classifyWorkbookContext(
  { roundtrip: { enabled: true, matrixId: 'm-source', templateId: 't-other' } },
  { matrixId: 'm-target', PreviousVersionID: 'm-prev', TemplateID: 't' },
);
assert.equal(foreignTemplate.kind, 'foreign-template');
```

- [ ] **Step 2: Run RED**

Run: `node tests/cross-matrix-context.mjs`

Expected: FAIL because `classifyWorkbookContext` is not exported/implemented.

- [ ] **Step 3: Implement the pure classifier and use it from `evaluatePlanSafety`**

```js
function classifyWorkbookContext(workbook, matrixInfo) {
  if (!workbook?.roundtrip?.enabled) return { kind: 'invalid-roundtrip' };
  const workbookTemplateId = canonicalValue(workbook.roundtrip.templateId || '');
  const currentTemplateId = canonicalValue(matrixInfo?.TemplateID || '');
  const workbookMatrixId = canonicalValue(workbook.roundtrip.matrixId || '');
  const currentMatrixId = canonicalValue(matrixInfo?.matrixId || '');
  const previousMatrixId = canonicalValue(matrixInfo?.PreviousVersionID || '');
  if (!workbookTemplateId || workbookTemplateId !== currentTemplateId) return { kind: 'foreign-template', workbookTemplateId, currentTemplateId, workbookMatrixId, currentMatrixId };
  if (workbookMatrixId && workbookMatrixId === currentMatrixId) return { kind: 'same-matrix', workbookTemplateId, currentTemplateId, workbookMatrixId, currentMatrixId };
  if (workbookMatrixId && workbookMatrixId === previousMatrixId) return { kind: 'previous-version', workbookTemplateId, currentTemplateId, workbookMatrixId, currentMatrixId };
  return { kind: 'same-template-foreign-matrix', workbookTemplateId, currentTemplateId, workbookMatrixId, currentMatrixId };
}
```

`evaluatePlanSafety` must keep `foreign-template` blocked, but must not call `suppressPlanForUnsafeContext` solely for `same-template-foreign-matrix`.

- [ ] **Step 4: Export the helper and run focused tests**

Run: `node tests/cross-matrix-context.mjs && node tests/global-context-suppression.mjs`

Expected: PASS; foreign-template suppression still works.

- [ ] **Step 5: Run full regression and commit**

Run: `npm test`

Commit: `feat: classify same-template cross-matrix imports`

---

### Task 2: Build a desired-final-state replacement plan

**Files:**
- Modify: `tessa-matrix-studio.user.js` around `buildPlan`, `buildRoundtripPlan`, `duplicateRowKey`
- Create: `tests/cross-matrix-replace.mjs`
- Create: `tests/cross-matrix-schema-drift.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildCrossMatrixReplacementPlan(workbook, structure, snapshot, columnMap, desired)`
- Adds `plan.crossMatrixReplacement = { enabled:true, sourceMatrixId, targetMatrixId, keepCount, addCount, deleteCount }`.
- Replacement action match markers: `cross-matrix-replace-keep`, `cross-matrix-replace-add`, `cross-matrix-replace-delete`.

- [ ] **Step 1: Write RED for the exact user scenario**

Create a source workbook from matrix A and import it against matrix B with the same template. Assert that foreign hidden IDs are ignored and final plan is not 476 SKIPs.

```js
const plan = E.buildPlan(sourceWorkbook, structure, targetSnapshot);
assert.equal(plan.crossMatrixReplacement.enabled, true);
assert.equal(plan.counts.skip, 0);
assert.equal(plan.counts.add, 2);
assert.equal(plan.counts.delete, 2);
for (const action of plan.actions.filter(a => a.type === 'add')) {
  assert.equal(action.excelRow.system.rowCardId, '');
  assert.equal(action.excelRow.system.versionId, '');
}
```

- [ ] **Step 2: Run RED**

Run: `node tests/cross-matrix-replace.mjs`

Expected: FAIL with old identity-anomaly/SKIP behavior.

- [ ] **Step 3: Implement foreign-identity stripping**

```js
function foreignDesiredRow(row) {
  return {
    ...row,
    system: { ...row.system, action: 'keep', rowCardId: '', versionId: '', baseFingerprint: '' },
  };
}
```

Do not mutate the parsed workbook in place.

- [ ] **Step 4: Implement semantic final-state matching**

For every foreign desired row, calculate `duplicateRowKey(null, desired, structure)`. Build a map of current target rows by `duplicateRowKey(current, null, structure)`.

Rules:

```js
if (matches.length === 1) -> NOOP keep that target identity;
if (matches.length === 0) -> ADD foreignDesiredRow(row);
if (matches.length > 1) -> fatal ambiguity;
all unmatched target rows -> DELETE;
```

This prevents unnecessary delete+re-add when rows are already semantically identical and avoids server duplicate conflicts.

- [ ] **Step 5: Make schema-drift semantics explicit**

`tests/cross-matrix-schema-drift.mjs` must assert:

```js
assert(plan.warnings.some(x => x.includes('удалённых из текущей структуры')));
assert(plan.warnings.some(x => x.includes('отсутствуют в Excel')));
assert(!plan.warnings.some(x => /сохранят текущие значения/i.test(x)), 'replacement ADD rows have no old target values to preserve');
```

In replacement mode, current-only fields are described as empty/default for new rows and validated by preflight; archive-only Excel columns remain ignored.

- [ ] **Step 6: Keep different-template import blocked**

Add assertion that `TemplateID !== current TemplateID` produces no executable replacement plan and safety stays blocked.

- [ ] **Step 7: Focused + full tests and commit**

Run: `node tests/cross-matrix-replace.mjs && node tests/cross-matrix-schema-drift.mjs && npm test`

Commit: `feat: plan same-template matrix replacement safely`

---

### Task 3: Add explicit replacement confirmation UI

**Files:**
- Modify: `tessa-matrix-studio.user.js` around Preview summary, Apply click flow and modal helpers
- Create: `tests/cross-matrix-replace-ui.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `replacementConfirmationModel(plan) -> plain object`
- Produces: `confirmCrossMatrixReplacement(plan) -> Promise<boolean>`
- Apply must not start CardService Store/Delete before confirmation resolves `true`.

- [ ] **Step 1: Write RED UI test**

Use jsdom and a replacement plan. Assert the modal contains source/target identity, `KEEP`, `ADD`, `DELETE`, schema drift, and the exact destructive warning.

```js
const model = E.replacementConfirmationModel(plan);
assert.equal(model.addCount, 476);
assert.equal(model.targetDeleteCount, 120);
assert.match(model.warning, /заменит содержимое текущей матрицы/i);
```

Also simulate Cancel and assert no call to `applyPlan`/CardService.

- [ ] **Step 2: Run RED**

Run: `node tests/cross-matrix-replace-ui.cjs`

Expected: FAIL because the replacement confirmation does not exist.

- [ ] **Step 3: Implement a dedicated confirmation, not generic `confirm()` text**

Modal body must state:

```text
Excel выгружен из другой карточки этого же шаблона.
Источник: <matrix/name>
Текущая матрица: <matrix/name>
Останется без изменений: N
Будет добавлено: N
Будет удалено из текущей матрицы: N

После применения содержимое текущей матрицы будет приведено к Excel.
```

Buttons: `Отмена` and `Да, выполнить перенос`.

- [ ] **Step 4: Add Preview badge**

Preview shows a persistent warning badge `ПЕРЕНОС ИЗ ДРУГОЙ МАТРИЦЫ`, not only a transient log line.

- [ ] **Step 5: Run focused/full tests and commit**

Run: `node tests/cross-matrix-replace-ui.cjs && npm test`

Commit: `feat: confirm cross-matrix replacement before apply`

---

### Task 4: Execute replacement in phases with compensation

**Files:**
- Modify: `tessa-matrix-studio.user.js` around `preflightPlan`, `applyPlan`, receipts/reconciliation
- Create: `tests/cross-matrix-replace-apply.mjs`
- Create: `tests/cross-matrix-replace-compensation.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `applyCrossMatrixReplacement(plan) -> ApplyResult`
- Result adds `replacement: { phase, desiredCount, createdCount, deletedCount, compensatedCount, cleanupIncomplete }`.

- [ ] **Step 1: RED — target DELETE must not run if any replacement ADD fails**

Fake bridge sequence: first ADD succeeds, second ADD fails. Assert:

```js
assert.equal(deleteCallsOnOriginalTarget, 0);
assert.equal(compensatingDeleteCallsOnNewRows, 1);
assert.equal(result.replacement.phase, 'add-failed');
```

- [ ] **Step 2: RED — successful ADD phase may proceed to target DELETE**

All ADDs succeed and verify. Assert target DELETEs begin only after final ADD acceptance.

- [ ] **Step 3: Implement replacement preflight as all-or-nothing for desired writes**

Use existing `preflightPlan` row validation, but if any replacement ADD/required field is skipped or fatal, mark replacement blocked before write:

```js
if (plan.crossMatrixReplacement?.enabled && preflight.runtimeSkips.length) {
  throw replacementBlocked('replacement-preflight-incomplete');
}
```

- [ ] **Step 4: Implement phase 1 ADD and compensation**

Track every newly created `rowCardId/versionId` receipt. If any ADD fails, call native DeleteRow for only those created by this run, save/refresh, reconcile cleanup, and never touch original target DELETE set.

- [ ] **Step 5: Implement phase 2 target DELETE**

Run only after all desired ADDs succeeded. Existing semantic KEEP rows are not deleted.

- [ ] **Step 6: Reconcile against desired semantic final set**

Create `reconcileReplacementFinalState(desired, snapshot, structure)` that compares multisets of `duplicateRowKey` values and reports missing/extra rows. Success requires exact desired final state.

- [ ] **Step 7: Focused/full tests and commit**

Run: `node tests/cross-matrix-replace-apply.mjs && node tests/cross-matrix-replace-compensation.mjs && npm test`

Commit: `feat: apply cross-matrix replacement in safe phases`

---

### Task 5: Establish a plain dictionary DTO boundary and fix circular serialization

**Files:**
- Modify: `tessa-matrix-studio.user.js` around dictionary loading/normalization, `refreshWorkbookDictionaries`, diagnostics capture
- Create: `tests/dictionary-dto-circular.mjs`
- Create: `tests/dictionary-dto-contract.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `toDictionaryEntryDto(value, context) -> plain DictionaryEntryDto`
- Produces: `toDictionaryCatalogDto(catalog) -> plain DictionaryCatalogDto`
- Produces: `assertJsonRoundtripSafe(value) -> value | throws`

- [ ] **Step 1: RED with an intentional TESSA-style cycle**

```js
const live = { id: '1', name: 'Иванов' };
live.fieldChanged = { _sender: live };
const dto = E.toDictionaryEntryDto(live, { idField: 'id', displayField: 'name' });
assert.doesNotThrow(() => JSON.stringify(dto));
assert.equal('fieldChanged' in dto, false);
```

Also run `refreshWorkbookDictionaries` with a catalog whose source object contains the same cycle and assert it does not fail with `Converting circular structure to JSON`.

- [ ] **Step 2: Run RED**

Run: `node tests/dictionary-dto-circular.mjs`

Expected: FAIL reproducing the circular serialization path or missing DTO helper.

- [ ] **Step 3: Implement whitelist DTO extraction**

Do not use a circular-replacer as the primary fix. Only copy known fields:

```js
return {
  id: normalizeSpace(source[idField]),
  display: normalizeSpace(source[displayField]),
  position: normalizeSpace(source[positionField]),
  organization: normalizeSpace(source[organizationField]),
  department: normalizeSpace(source[departmentField]),
  roleTypeId: source.roleTypeId ?? null,
  flags: plainKnownFlags(source),
};
```

- [ ] **Step 4: Put DTO conversion at every serialization boundary**

Before IndexedDB cache, XLSX dictionary sheet, diagnostics capture and refresh output, normalize with `toDictionaryCatalogDto`.

- [ ] **Step 5: Add a development assertion**

`assertJsonRoundtripSafe(dto)` performs `JSON.stringify/parse` only on DTOs in tests/diagnostics; runtime business logic never serializes live cards/controls.

- [ ] **Step 6: Focused/full tests and commit**

Run: `node tests/dictionary-dto-circular.mjs && node tests/dictionary-dto-contract.mjs && npm test`

Commit: `fix: isolate dictionary DTOs from TESSA runtime objects`

---

### Task 6: Make employee identity position-aware

**Files:**
- Modify: `tessa-matrix-studio.user.js` around role/user dictionary projection, `finalizeDictionaryEntries`, search text and picker display
- Create: `tests/picker-employee-disambiguation.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `employeeDisplayLabel(entry) -> string`
- Produces stable search aliases for `ФИО`, `ФИО — должность`, optional org/department.

- [ ] **Step 1: RED duplicate-FIO test**

```js
const a = { id:'u1', display:'Иванов Иван Иванович', position:'Юрист' };
const b = { id:'u2', display:'Иванов Иван Иванович', position:'Экономист' };
assert.notEqual(E.employeeDisplayLabel(a), E.employeeDisplayLabel(b));
const hits = E.searchPickerEntries([a,b], 'Иванов');
assert.equal(hits.length, 2);
```

- [ ] **Step 2: Implement display/search projection**

Default visible label: `ФИО — должность`. If both are still identical and organization/department exists, append ` · организация / подразделение`.

- [ ] **Step 3: Keep stable ID as hidden identity**

No comparison or persistence may use the composite display label as identity.

- [ ] **Step 4: Focused/full tests and commit**

Run: `node tests/picker-employee-disambiguation.mjs && npm test`

Commit: `feat: disambiguate employees by position`

---

### Task 7: Add bulk «Собрать значения» resolution

**Files:**
- Modify: `tessa-matrix-studio.user.js` around picker state/UI/search
- Create: `tests/picker-bulk-collect.mjs`
- Create: `tests/picker-bulk-ui.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseBulkPickerInput(text) -> string[]`
- Produces: `resolveBulkPickerValues(tokens, dictionary) -> { resolved, ambiguous, missing }`

- [ ] **Step 1: RED parser/resolution tests**

Input:

```text
Иванов Иван Иванович — Юрист
Петров Пётр Петрович; Сидоров Сидор Сидорович
```

Expected three tokens. Exact composite display resolves automatically. A bare FIO with two matching positions is `ambiguous`, not guessed. Missing value is preserved verbatim in `missing`.

- [ ] **Step 2: Implement deterministic resolution order**

```text
stable ID -> exact full selector -> exact full display -> unique normalized composite -> unique normalized FIO -> ambiguous/missing
```

- [ ] **Step 3: Add picker UI**

Add textarea/input mode `Собрать значения`. Pressing Enter with multiline/pasted content resolves the entire buffer. Show three sections: selected/resolved, ambiguous, not found.

- [ ] **Step 4: Require explicit choice for ambiguity**

Ambiguous entries show candidates with position and stable selector; user clicks one. Bulk apply remains blocked only for unresolved tokens the user has not dismissed/corrected.

- [ ] **Step 5: Focused/full tests and commit**

Run: `node tests/picker-bulk-collect.mjs && node tests/picker-bulk-ui.cjs && npm test`

Commit: `feat: collect multiple picker values from pasted lists`

---

### Task 8: Redesign picker type-ahead and dictionary binding diagnostics

**Files:**
- Modify: `tessa-matrix-studio.user.js` around picker rendering, `pickerColumns`, `searchPickerEntries`
- Create: `tests/picker-binding-audit.mjs`
- Create: `tests/picker-ui-contract.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `dictionaryBindingForColumn(column, catalog) -> { expectedCatalogId, actualCatalogId, sourceView, projection, status }`
- Produces: `auditDictionaryBindings(structure, columnMap, catalog) -> BindingAudit[]`.

- [ ] **Step 1: RED binding mismatch test**

Construct two columns and deliberately route one to the wrong catalog. Assert audit says:

```js
{ status:'fail', column:'Подписание', expectedCatalogId:'roles', actualCatalogId:'departments' }
```

- [ ] **Step 2: Implement one binding source of truth**

Picker must obtain the same `columnCatalogIds[column.key]` mapping used by import validation; do not independently infer by caption.

- [ ] **Step 3: Implement reliable Studio type-ahead**

Typing filters immediately over prebuilt `dictionaryLookup/searchText`; keyboard `ArrowDown/ArrowUp/Enter/Escape` works; current result count and source are visible.

- [ ] **Step 4: Redesign visible picker header**

Show `Столбец · тип · источник · найдено N`, selected chips and human labels. Move GUID/projection details to a collapsible diagnostics section.

- [ ] **Step 5: Add per-column diagnostic test**

Every dictionary-backed column must be audited even if no current row contains a populated example. This closes the existing gap where field diagnostics can return `not-run` merely because the matrix has no sample value.

- [ ] **Step 6: Focused/full tests and commit**

Run: `node tests/picker-binding-audit.mjs && node tests/picker-ui-contract.cjs && npm test`

Commit: `feat: audit and simplify dictionary picker bindings`

---

### Task 9: Preserve portable Excel validation without macros

**Files:**
- Modify: `tessa-matrix-studio.user.js` around `buildRoundtripGrid`, XLSX data validations/named ranges
- Create: `tests/xlsx-data-validation.mjs`
- Modify: `package.json`

**Interfaces:**
- Generated `.xlsx` keeps list/named-range validation for embedded catalogs.
- Guaranteed autocomplete remains Studio picker behavior; Excel does not gain VBA/ActiveX.

- [ ] **Step 1: RED XLSX validation contract**

Generate a workbook and inspect worksheet XML/workbook names. Assert dictionary-backed cells reference valid list/named ranges and invalid typed values receive a Stop/Warning rule consistent with current UX.

- [ ] **Step 2: Ensure dynamic ranges reference only actual embedded entries**

Do not create million-row validation references when a catalog is thin/not embedded.

- [ ] **Step 3: Add user-facing note**

In instructions, distinguish `Excel dropdown/validation` from Studio `search/autocomplete`, avoiding a promise that every desktop Excel build provides type-ahead inside Data Validation.

- [ ] **Step 4: Focused/full tests and commit**

Run: `node tests/xlsx-data-validation.mjs && npm test`

Commit: `feat: keep portable Excel dictionary validation`

---

### Task 10: Discover and enforce «Ведение дела производства = Да» legal-entity filtering

**Files:**
- Modify: `tessa-matrix-studio.user.js` around reference view loading/catalog projection
- Create: `tests/legal-entity-production-filter.mjs`
- Create: `tests/legal-entity-filter-diagnostics.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `discoverProductionRecordkeepingFlag(projection) -> { proven, field, caption }`
- Produces: `filterProductionLegalEntities(entries, flagInfo) -> { entries, sourceCount, acceptedCount, rejectedCount, applied, reason }`.

- [ ] **Step 1: Add a read-only runtime diagnostic probe before enabling filtering**

For the legal-entity source view, capture projection column names/captions/types and a bounded sample of normalized boolean values. The implementation must identify a field whose caption/key corresponds to `Ведение дела производства`.

- [ ] **Step 2: RED filter test**

```js
const flag = { proven:true, field:'ProductionRecordkeeping' };
const result = E.filterProductionLegalEntities([
  {id:'1', display:'ЮЛ 1', flags:{ProductionRecordkeeping:true}},
  {id:'2', display:'ЮЛ 2', flags:{ProductionRecordkeeping:false}},
], flag);
assert.deepEqual(result.entries.map(x => x.id), ['1']);
```

- [ ] **Step 3: RED fail-open visibility test**

If flag projection is not proven, `applied === false`, all entries remain present, and diagnostics contain `filter-not-proven`. Do not silently hide legal entities.

- [ ] **Step 4: Apply filtering before indexing/cache/XLSX**

This reduces memory and workbook size. Stats must report `sourceCount/acceptedCount/rejectedCount`.

- [ ] **Step 5: Focused/full tests and commit**

Run: `node tests/legal-entity-production-filter.mjs && node tests/legal-entity-filter-diagnostics.mjs && npm test`

Commit: `feat: filter production legal entities by proven TESSA flag`

---

### Task 11: Add end-to-end performance telemetry

**Files:**
- Modify: `tessa-matrix-studio.user.js` around export/import/dictionary/preview stages and diagnostics package
- Create: `tests/performance-telemetry.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `createPerformanceTrace()` with `start(stage, meta)`, `finish(token, meta)`, `snapshot()`.
- Diagnostics file: `performance.json`.

- [ ] **Step 1: RED telemetry test**

Assert a synthetic export/import records these stage IDs exactly:

```text
structure
snapshot
catalog-load:<catalogId>
catalog-normalize
xlsx-grid
xlsx-xml
xlsx-zip
xlsx-read
preview-plan
```

Each stage has `durationMs >= 0`, counts and byte metrics where available.

- [ ] **Step 2: Instrument without changing behavior**

No optimization in this task. Wrap existing stage boundaries and include telemetry in normal diagnostics/UAT.

- [ ] **Step 3: Add per-catalog metrics**

Record source entries, retained entries, serialized entries and estimated/actual XML bytes.

- [ ] **Step 4: Focused/full tests and commit**

Run: `node tests/performance-telemetry.mjs && npm test`

Commit: `feat: trace matrix export and preview performance`

---

### Task 12: Optimize high-cardinality catalogs and workbook generation

**Files:**
- Modify: `tessa-matrix-studio.user.js` around dictionary load/cache, `buildRoundtripGrid`, XML/ZIP generation
- Create: `tests/dictionary-load-dedup.mjs`
- Create: `tests/xlsx-large-catalog-representation.mjs`
- Create: `tests/xlsx-large-catalog-roundtrip.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `workbookCatalogStrategy(catalog, options) -> { mode:'embedded'|'thin', reason, estimatedBytes }`.
- Thin mode is representation, not rejection.

- [ ] **Step 1: RED — same catalog used by several columns loads only once**

Fake source loader counts calls. Two columns referencing the same catalog ID must produce exactly one load and one normalized lookup index.

- [ ] **Step 2: RED — high-cardinality catalog does not create one giant selector sheet by default**

Create a synthetic 200k-entry employee catalog. Assert `workbookCatalogStrategy` selects `thin` based on estimated serialized bytes and generated workbook remains importable.

- [ ] **Step 3: Implement thin representation**

Thin mode embeds:

- catalog metadata/projection/filter signature;
- currently used selectors and visible values;
- no complete 200k-entry list.

During Preview, live/current catalog resolution is authoritative for values not embedded. This preserves correctness without bloating `.xlsx`.

- [ ] **Step 4: Reuse cache by structure/catalog signature**

Explicit `Обновить справочники` and UAT force refresh. Ordinary repeated export uses current valid normalized cache.

- [ ] **Step 5: Keep current XLSX security invariants**

Run existing `xlsx-archive-security`, `xlsx-spreadsheetml-security`, OPC relationship and roundtrip tests in the focused command.

- [ ] **Step 6: Focused/full tests and commit**

Run:

```bash
node tests/dictionary-load-dedup.mjs && \
node tests/xlsx-large-catalog-representation.mjs && \
node tests/xlsx-large-catalog-roundtrip.mjs && \
node tests/xlsx-archive-security.mjs && \
node tests/xlsx-spreadsheetml-security.mjs && \
npm test
```

Commit: `perf: reduce high-cardinality workbook payloads`

---

### Task 13: Build deterministic UAT runner core

**Files:**
- Modify: `tessa-matrix-studio.user.js` near diagnostics/runtime-recorder code
- Create: `tests/full-uat-seed.mjs`
- Create: `tests/full-uat-runner.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `createSeededRandom(seed) -> () => number`
- Produces: `selectUatScenarioTargets(snapshot, structure, catalog, seed) -> UatTargets`
- Produces: `runFullUat(context, options) -> UatReport`.

- [ ] **Step 1: RED deterministic seed test**

```js
const a = E.selectUatScenarioTargets(snapshot, structure, catalog, 194735821);
const b = E.selectUatScenarioTargets(snapshot, structure, catalog, 194735821);
assert.deepEqual(a, b);
```

Different seeds should normally select different eligible row/column targets.

- [ ] **Step 2: Implement seed generator without external dependency**

Use a small deterministic integer PRNG such as Mulberry32; store unsigned 32-bit seed in report.

- [ ] **Step 3: Implement UAT state machine**

States exactly:

```text
preflight -> binding-audit -> dictionary-refresh -> picker-audit -> positive-write -> duplicate -> negative-input -> fault-injection -> cleanup -> packaging
```

Each check record contains `id`, `group`, `status`, `startedAt`, `finishedAt`, `detail`, `expected`, `actual`, `writeAttempted`, `column`, `excelRow` when relevant.

- [ ] **Step 4: Reuse native recorder automatically**

Call existing `startNativeOperationRecorder()` before the first write-capable scenario and always `stopNativeOperationRecorder()`/restore methods in `finally`.

- [ ] **Step 5: Focused/full tests and commit**

Run: `node tests/full-uat-seed.mjs && node tests/full-uat-runner.mjs && npm test`

Commit: `feat: add deterministic full UAT runner core`

---

### Task 14: Add all-column dictionary and picker audit to UAT

**Files:**
- Modify: `tessa-matrix-studio.user.js` UAT scenario group
- Create: `tests/full-uat-column-audit.mjs`
- Modify: `package.json`

**Interfaces:**
- Reuses `auditDictionaryBindings` from Task 8.
- Produces ZIP entry `column-bindings.json` and `picker-audit.json`.

- [ ] **Step 1: RED all-column coverage test**

A structure with 12 editable columns, including three currently empty in the matrix, must produce 12 audit results. Empty current data is not a reason for `not-run`.

- [ ] **Step 2: Audit the full chain**

For each column record:

```text
Excel header
schema token
criterion/function ID
operand type
expected catalog ID
actual catalog ID
source view/projection
picker catalog ID
resolution probe result
```

Mismatch is a named FAIL tied to that column.

- [ ] **Step 3: Test picker resolution without mutating live cells**

Use picker model/search/resolution helpers directly for read-only audit; no server Store.

- [ ] **Step 4: Focused/full tests and commit**

Run: `node tests/full-uat-column-audit.mjs && npm test`

Commit: `feat: audit every matrix column in full UAT`

---

### Task 15: Add real temporary positive-write UAT scenarios

**Files:**
- Modify: `tessa-matrix-studio.user.js` UAT runner
- Create: `tests/full-uat-positive-write.mjs`
- Create: `tests/full-uat-cleanup.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `createUatTemporaryRow(sourceRow, mutation, context) -> desired row`
- Produces: `cleanupUatArtifacts(context, ledger) -> CleanupReport`.

- [ ] **Step 1: RED write-order/ledger test**

Ledger must record every created row immediately after Store acceptance, before later scenarios can fail.

- [ ] **Step 2: Implement UAT row A**

Flow:

```text
clone random valid source -> ADD -> readback
choose another real value from one safe dictionary-backed/typed column -> UPDATE -> readback
choose an optional populated field -> CLEAR -> UPDATE -> readback
```

Do not mutate the original source row.

- [ ] **Step 3: Implement UAT row B**

Flow:

```text
clone another source -> ADD -> readback
construct workbook model where row is physically absent -> planner must produce DELETE
execute native DeleteRow -> verify absence
```

- [ ] **Step 4: Cleanup in `finally`**

Delete any UAT-created rows still present, native save/refresh, then compare final snapshot semantic multiset with the original pre-UAT snapshot.

- [ ] **Step 5: UNSAFE on cleanup uncertainty**

If any UAT-created identity remains or snapshot cannot be verified, top-level status is `UNSAFE`, and report lists exact technical identities for manual cleanup.

- [ ] **Step 6: Focused/full tests and commit**

Run: `node tests/full-uat-positive-write.mjs && node tests/full-uat-cleanup.mjs && npm test`

Commit: `feat: exercise temporary write flows in full UAT`

---

### Task 16: Add negative-input and scoped fault-injection UAT

**Files:**
- Modify: `tessa-matrix-studio.user.js` UAT runner/adapters
- Create: `tests/full-uat-negative.mjs`
- Create: `tests/full-uat-fault-injection.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `createFaultInjectedBridge(realBridge, faultSpec) -> bridge-like adapter`
- `faultSpec` may target `get`, `duplicate`, `store`, `delete`, `refresh`, `reconcile` with `throw`, `validation-fail`, `timeout`, `incomplete`.

- [ ] **Step 1: Add negative user-input scenarios**

Test fixtures must cover:

```text
unknown dictionary value
ambiguous duplicate FIO
invalid boolean
text in number field
malformed interval
reversed interval
formula/cached coercion
clear last required role
stale MatrixVersionID
wrong MatrixID
wrong TemplateID
duplicate hidden identity
```

Each scenario passes only when expected error classification appears and `writeAttempted === false`.

- [ ] **Step 2: RED false-success test for Store fault**

Inject Store failure. Assert UAT and Apply accounting cannot report `success`, and no later destructive cleanup of original business rows occurs.

- [ ] **Step 3: Implement fault adapter with strict scope restoration**

Patch only the adapter passed to the scenario; do not monkey-patch global CardService for synthetic fault tests. Restore/throw away adapter after each scenario.

- [ ] **Step 4: Cover Get/Delete/refresh/reconciliation failures**

Each injected fault must produce the expected result class and preserve diagnostic packaging.

- [ ] **Step 5: Focused/full tests and commit**

Run: `node tests/full-uat-negative.mjs && node tests/full-uat-fault-injection.mjs && npm test`

Commit: `test: exercise UAT error handling and fault paths`

---

### Task 17: Package one UAT ZIP and add one-button UI

**Files:**
- Modify: `tessa-matrix-studio.user.js` diagnostics UI/package builder
- Create: `tests/full-uat-package.mjs`
- Create: `tests/full-uat-ui.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `makeUatDiagnosticPackage(report, artifacts) -> Uint8Array`
- Produces: `summarizeUatReport(report) -> { status, passed, failed, incomplete, unsafe, headline }`.

- [ ] **Step 1: RED ZIP content contract**

Assert ZIP includes exactly the core artifacts:

```text
summary.json
uat-report.json
timeline.json
native-action.json
runtime-surface.json
dictionary-audit.json
column-bindings.json
picker-audit.json
mutation-receipts.json
reconciliation.json
cleanup.json
performance.json
README.txt
```

Additional bounded/sharded dictionary details may be included, but these files are mandatory.

- [ ] **Step 2: Implement status reduction**

Priority: `UNSAFE > FAILED > INCOMPLETE > PASSED`. Cleanup uncertainty always wins.

- [ ] **Step 3: Add separate diagnostics block**

UI label: `Полный UAT с записью`.

Before start show:

```text
UAT временно создаст тестовые строки в текущей матрице и удалит их после проверки.
Матрица должна быть черновиком. Все действия будут записаны в диагностический ZIP.
```

Buttons: `Отмена`, `Запустить UAT`.

- [ ] **Step 4: Add visible phase progress and final download**

Progress follows Task 13 states. Final view shows pass/fail counts, cleanup status, seed, and one `Скачать UAT ZIP` button.

- [ ] **Step 5: Ensure ZIP generation survives scenario failures**

A failed scenario still packages all artifacts gathered so far. Only catastrophic inability to construct ZIP itself may prevent download.

- [ ] **Step 6: Focused/full tests and commit**

Run: `node tests/full-uat-package.mjs && node tests/full-uat-ui.cjs && npm test`

Commit: `feat: add one-button full UAT diagnostic package`

---

### Task 18: Coverage, documentation and release proof

**Files:**
- Modify: `tests/coverage-manifest.json`
- Modify: `tests/test-coverage-contract.mjs`
- Modify: `docs/TEST-STRATEGY.md`
- Modify: `docs/CODE-MAP.md`
- Modify: `README.md`
- Verify: `.github/workflows/quality.yml`, `.github/workflows/uat-candidate.yml`, `.github/workflows/release.yml`

**Interfaces:**
- No new production API. This task makes the previous behavior release-enforced and discoverable.

- [ ] **Step 1: Add feature groups to coverage manifest**

Add explicit groups for:

```text
cross-matrix-replacement
dictionary-dto
employee-disambiguation
bulk-picker
column-binding-audit
legal-entity-production-filter
large-catalog-performance
full-uat-runner
full-uat-negative
full-uat-cleanup
full-uat-package
```

Each write-critical group names its permanent regression tests.

- [ ] **Step 2: Update TEST-STRATEGY**

Document that Full UAT is an application self-test and diagnostics accelerator, while release still requires exact-artifact native evidence.

- [ ] **Step 3: Update CODE-MAP/README**

Document user flows:

```text
Same matrix Excel -> ordinary merge
Foreign same-template Excel -> explicit replacement confirmation
Foreign template -> blocked
Read-only diagnostics -> no writes
Full UAT -> temporary writes + cleanup + one ZIP
```

Also document bulk value collection, employee position labels and the legal-entity filter evidence requirement.

- [ ] **Step 4: Run final local regression**

Run: `npm ci && npm test`

Expected: PASS.

- [ ] **Step 5: Open PR and wait for real Quality gate**

Required checks: Tests success, CodeQL success, High/Critical gate success.

- [ ] **Step 6: Build exact UAT candidate and perform live TESSA validation**

Use existing `.github/workflows/uat-candidate.yml`. Install the exact artifact. Run:

1. ordinary mixed ADD/UPDATE/DELETE;
2. same-template cross-matrix replacement on a disposable/test matrix;
3. Full UAT button and download resulting ZIP;
4. verify cleanup returns the matrix to its original semantic snapshot.

- [ ] **Step 7: Inspect Full UAT ZIP before release**

Release candidate is blocked if:

```text
cleanup status != verified
any required column binding failed
replacement final-state reconciliation != verified
native recorder restoration failed
unexpected Store/Delete occurred in negative scenarios
UAT package is truncated/incomplete for a required write scenario
```

- [ ] **Step 8: Generate existing native evidence attestation**

Use the already-established native DELETE+SAVE recorder/evidence tooling against the exact candidate SHA. Do not weaken the release gate to accept Full UAT alone.

- [ ] **Step 9: Merge/release only after exact-artifact evidence gate succeeds**

Verify published `latest` and public asset SHA after release.

Commit docs/coverage: `docs: cover replacement picker performance and full UAT`

---

## Self-review against the spec

- Cross-matrix same-template transfer, explicit confirmation, phased ADD-before-DELETE and compensation: Tasks 1–4.
- Schema drift wording and foreign-template fail-closed: Tasks 1–3.
- Circular JSON root cause via DTO boundary: Task 5.
- Duplicate FIO with positions: Task 6.
- Bulk `Собрать значения` and Enter resolution: Task 7.
- Picker frontend/type-ahead and every-column dictionary binding audit: Task 8.
- Portable Excel validation without macros: Task 9.
- `Ведение дела производства = Да` legal-entity filtering with proof/fail-visible behavior: Task 10.
- Large matrix export/import performance and high-cardinality catalog strategy: Tasks 11–12.
- Random reproducible Full UAT, native recording, positive writes, negative cases, fault injection, cleanup and one ZIP: Tasks 13–17.
- UAT-of-UAT regression coverage and release safety: Tasks 13–18.
- Existing exact-artifact live evidence gate preserved: Task 18.

No spec requirement is intentionally deferred. CPU offloading to a Web Worker is explicitly not included in the first optimization pass; Task 12 representation/cache work is measured first, and worker support is a separate follow-up only if telemetry proves it is still necessary.

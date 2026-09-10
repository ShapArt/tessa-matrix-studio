# Warehouse Logistics v14 Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only Warehouse Logistics v14 preview inside the exact TESSA Matrix Studio userscript used by UAT/release, with deterministic fail-closed planning and zero Warehouse-specific writes.

**Architecture:** A dual-environment pure kernel (`warehouse/warehouse-logistics-v14.cjs`) owns business normalization/classification and has no TESSA/browser dependency. A browser adapter (`warehouse/warehouse-v14-runtime.js`) reads the existing `window.__TESSA_MATRIX_SYNC_EXPORTS__` seam, converts the live `TessaBridge` structure/snapshot into plain facts, invokes the kernel, and exposes only read/preview functions. A single production build script composes the root userscript, existing range transform and interval overlay, the Warehouse kernel, and the Warehouse runtime; UAT and Release both call that script so source tests cannot drift from the shipped artifact.

**Tech Stack:** JavaScript/Node.js 24, Tampermonkey userscript, GitHub Actions, existing TESSA Matrix Studio regression harness.

**Spec:** `docs/superpowers/specs/2026-09-10-warehouse-v14-runtime-design.md`

## Global Constraints

- First milestone is read + classify + preview only; no Warehouse-specific Store/Delete callable may be exposed.
- Directorate target is exactly `Дирекция Направлений`; function target is exactly `Складская логистика`.
- Newer Warehouse task / `Свод Логистика 12.08.26` outranks legacy matrix state when interpreting target business rules.
- `Соколов Лев` / `Лев Соколов` may map to `Гринкевич Вадим Викторович` only inside proven Warehouse scope.
- Performer/site/category resolution for an APPLY-capable future plan must be exact and unique; this milestone reports blockers instead of fuzzy guessing.
- Site-bound roles may be sliced by site; global performers must not be exploded to one row per site.
- The two business maintenance categories collapse explicitly to one system category `ТО, ремонт оборудования и техники для склада`.
- VGO revenue and expense routes remain separate from ordinary Warehouse routes.
- Empty criteria keep wildcard/no-restriction semantics; multi-values keep OR semantics; accidental overlap is a blocker.
- Production bundle must contain the Warehouse kernel/runtime marker and pass `node --check`.
- Existing generic TESSA CRUD semantics are not refactored by this milestone.

---

### Task 1: Production composition seam and RED bundle contract

**Files:**
- Create: `tools/build-production-userscript.mjs`
- Create: `tests/warehouse-production-bundle.mjs`
- Modify: `.github/workflows/uat-candidate.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: root `tessa-matrix-studio.user.js`, `hotfixes/malformed-range-diagnostic-transform.mjs`, `hotfixes/interval-add-valid-fallback.js`, future Warehouse source files.
- Produces: CLI `node tools/build-production-userscript.mjs <version> <output-path>` and exact composed userscript containing `__TMS_INSTALL_INTERVAL_ADD_VALID_FALLBACK__`, `Numeric ranges have an exact grammar`, `__TMS_WAREHOUSE_V14_KERNEL__`, and `__TMS_WAREHOUSE_V14__`.

- [ ] **Step 1: Write the failing production-bundle test**

Create `tests/warehouse-production-bundle.mjs` that copies the repository into a temp output path only through the build CLI, asserts the CLI exists, then asserts the output contains all four required markers and passes `node --check` via `spawnSync(process.execPath, ['--check', output])`.

- [ ] **Step 2: Run the test to verify RED**

Run: `node tests/warehouse-production-bundle.mjs`

Expected: FAIL because `tools/build-production-userscript.mjs` and/or Warehouse markers do not exist yet.

- [ ] **Step 3: Implement one build script**

`tools/build-production-userscript.mjs` must:

```js
const [version, outputPath] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('version must be semver x.y.z');
if (!outputPath) throw new Error('output path is required');
```

Then copy the root userscript to `outputPath`, invoke the existing malformed-range transformer against that path, rewrite `@version` and `APP.version`, append in this exact order with one newline boundary between each file:

1. `hotfixes/interval-add-valid-fallback.js`
2. `warehouse/warehouse-logistics-v14.cjs`
3. `warehouse/warehouse-v14-runtime.js`

Finally run an internal syntax check through `spawnSync(process.execPath, ['--check', outputPath])`; fail non-zero if any required marker is absent.

- [ ] **Step 4: Replace duplicated workflow composition**

In both UAT and Release workflows, replace direct `cp/node transform/sed/cat` composition with:

```bash
node tools/build-production-userscript.mjs "$VERSION" dist/tessa-matrix-studio.user.js
```

Keep meta extraction, ZIP/SHA/provenance/evidence logic unchanged. Extend release change detection and ZIP contents so `warehouse/**` and `tools/build-production-userscript.mjs` count as production runtime changes and are included where source overlays are packaged.

- [ ] **Step 5: Register the bundle regression in `npm test`**

Append `node tests/warehouse-production-bundle.mjs` to the existing `scripts.test` chain in `package.json` without reordering existing regressions.

- [ ] **Step 6: Run RED again**

Run: `node tests/warehouse-production-bundle.mjs`

Expected: still FAIL specifically because the Warehouse source files/markers are not present. This proves the production contract is active before implementing the feature.

- [ ] **Step 7: Commit**

Commit message: `test: enforce Warehouse runtime in production bundle`

---

### Task 2: Pure Warehouse v14 kernel

**Files:**
- Create: `warehouse/warehouse-logistics-v14.cjs`
- Create: `tests/warehouse-v14-kernel.mjs`

**Interfaces:**
- Consumes: plain JSON-compatible `{ matrix, structure, rows }` facts from the browser adapter.
- Produces: global/module API with `VERSION`, `SPEC`, `normalizeText`, `systemCategoryForBusiness`, `classifyRow`, `planWarehousePreview`, and `stablePlan`.

The source is dual-environment and must start from this contract:

```js
(function installWarehouseV14Kernel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__TMS_WAREHOUSE_V14_KERNEL__ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function warehouseV14Factory() {
  'use strict';
  const VERSION = '14.0.0-preview';
  // pure functions only
  return { VERSION, SPEC, normalizeText, systemCategoryForBusiness, classifyRow, planWarehousePreview, stablePlan };
});
```

- [ ] **Step 1: Write kernel RED fixtures**

`tests/warehouse-v14-kernel.mjs` loads the `.cjs` API with `createRequire`. Fixtures must assert:

```js
assert.equal(systemCategoryForBusiness('ТО и ремонт оборудования для склада'), 'ТО, ремонт оборудования и техники для склада');
assert.equal(systemCategoryForBusiness('ТО и ремонт спец. техники для склада'), 'ТО, ремонт оборудования и техники для склада');
```

Also assert classification of exact `Дирекция Направлений` + `Складская логистика`, unrelated rows remain `unrelated`, ambiguous rows return blockers, and `stablePlan(input)` is byte-identical after reversing input row order.

Add route fixtures proving ordinary signing thresholds, VGO revenue/expense separation, and special-expert route data remain separate fields in the returned evidence model.

- [ ] **Step 2: Run kernel test to verify RED**

Run: `node tests/warehouse-v14-kernel.mjs`

Expected: FAIL because kernel file/API does not exist.

- [ ] **Step 3: Implement exact configuration and normalization**

`SPEC` contains exact target names, legacy aliases, explicit category mapping, route tables, and scope-kind metadata (`site` versus `global`). `normalizeText` may collapse whitespace and Unicode dash variants, but must not fuzzy-match different names.

- [ ] **Step 4: Implement row classification and blockers**

`classifyRow(row)` returns one of:

```js
{ kind: 'target' | 'shared-legacy' | 'unrelated' | 'ambiguous' | 'unsupported', reasons: [] }
```

A row is `target` only when explicit directorate/function facts prove the Warehouse target. A row that includes Warehouse plus another function/directorate becomes `shared-legacy`. Missing/contradictory dimensions become `ambiguous`/`unsupported`, never target by inference.

- [ ] **Step 5: Implement deterministic preview planning**

`planWarehousePreview(facts)` returns:

```js
{
  format: 'TMS_WAREHOUSE_V14_PREVIEW_V1',
  status: 'ready' | 'blocked' | 'noop',
  summary: { totalRows, targetRows, sharedRows, unrelatedRows, blockerCount },
  actions: [{ type: 'PATCH' | 'SPLIT' | 'ADD' | 'NOOP', sourceRowId, scope, desired, evidence }],
  blockers: [{ code, sourceRowId, detail }],
  evidence: { routes, categoryMap, globalPerformers, siteBoundRoles }
}
```

For this milestone, actions are semantic preview actions only. No TESSA writer payload, Store request, Delete request, or callable mutation function is returned.

- [ ] **Step 6: Implement stable ordering/idempotent state detection**

`stablePlan` canonicalizes rows/actions/blockers by stable keys before JSON output. An already-target fixture returns `status: 'noop'` with only NOOP actions and no synthetic ADD explosion.

- [ ] **Step 7: Run kernel tests GREEN**

Run: `node tests/warehouse-v14-kernel.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

Commit message: `feat: add pure Warehouse v14 preview kernel`

---

### Task 3: Read-only browser adapter over the existing Studio export seam

**Files:**
- Create: `warehouse/warehouse-v14-runtime.js`
- Create: `tests/warehouse-v14-runtime.mjs`
- Modify: `tessa-matrix-studio.user.js`

**Interfaces:**
- Consumes: `window.__TESSA_MATRIX_SYNC_EXPORTS__`, especially `TessaBridge`, `canonicalValue`, `normalizeSpace`; consumes global `__TMS_WAREHOUSE_V14_KERNEL__` installed immediately before runtime in production composition.
- Produces: `window.__TMS_WAREHOUSE_V14__ = Object.freeze({ version, status, collectFacts, preview })` with no mutation method.

- [ ] **Step 1: Write browser-runtime RED test**

Use `vm` with a fake `window`, fake kernel, and fake `__TESSA_MATRIX_SYNC_EXPORTS__`. Assert runtime:

- fails closed with `TMS_WAREHOUSE_V14_INCOMPATIBLE` when base exports/kernel are absent;
- calls `TessaBridge.create()`, `requestStructure(templateId)` and `loadSnapshot(structure)` exactly once for one preview;
- converts snapshot rows into plain cloned facts without mutating source objects;
- exposes no key matching `/apply|store|delete|write/i`;
- returns the kernel preview verbatim plus adapter metadata.

- [ ] **Step 2: Run runtime test to verify RED**

Run: `node tests/warehouse-v14-runtime.mjs`

Expected: FAIL because runtime file does not exist.

- [ ] **Step 3: Export one safe read seam from the root Studio**

Add `warehouseFactsFromSnapshot(structure, snapshot, matrixInfo)` to the root userscript and export it through `window.__TESSA_MATRIX_SYNC_EXPORTS__`. It must clone only serializable facts required by Warehouse planning: row identity, flat display values keyed by exact column captions/keys, structure condition/function captions/IDs, and matrix/template identity. It must not expose card service or mutation methods.

- [ ] **Step 4: Implement runtime compatibility and read path**

The runtime verifies `TessaBridge`, `warehouseFactsFromSnapshot`, and kernel `planWarehousePreview` exist. `preview()` performs:

```js
const bridge = await exportsApi.TessaBridge.create();
const structure = await bridge.requestStructure(bridge.templateId());
const snapshot = await bridge.loadSnapshot(structure);
const facts = exportsApi.warehouseFactsFromSnapshot(structure, snapshot, bridge.matrixInfo());
return kernel.planWarehousePreview(facts);
```

Any compatibility or fact-resolution error is returned as a blocked diagnostic with a stable code; no write is attempted.

- [ ] **Step 5: Run runtime tests GREEN**

Run: `node tests/warehouse-v14-runtime.mjs`

Expected: PASS.

- [ ] **Step 6: Run production bundle contract GREEN**

Run: `node tests/warehouse-production-bundle.mjs`

Expected: PASS and exact built file contains both Warehouse markers.

- [ ] **Step 7: Commit**

Commit message: `feat: expose read-only Warehouse v14 runtime`

---

### Task 4: Harden exact production/UAT verification

**Files:**
- Modify: `tests/release-workflow.mjs`
- Modify: `tests/workflow-security.mjs` only if its allowlist needs the new build script command.
- Modify: `.github/workflows/uat-candidate.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `tools/build-production-userscript.mjs` and Warehouse markers.
- Produces: CI assertions that both shipment paths use the same composer and reject artifacts missing Warehouse v14.

- [ ] **Step 1: Add workflow contract assertions**

Assert both workflows contain the exact composer invocation and do not contain direct `cat hotfixes/interval-add-valid-fallback.js >> dist/tessa-matrix-studio.user.js` composition anymore. Assert Release change detection includes `warehouse/` and `tools/build-production-userscript.mjs`.

- [ ] **Step 2: Run targeted workflow tests**

Run: `node tests/release-workflow.mjs && node tests/workflow-security.mjs && node tests/warehouse-production-bundle.mjs`

Expected: PASS.

- [ ] **Step 3: Run full repository suite**

Run: `npm test`

Expected: PASS with no existing regression removed or bypassed.

- [ ] **Step 4: Commit**

Commit message: `ci: unify Warehouse UAT and release composition`

---

### Task 5: PR and exact UAT candidate gate

**Files:**
- No production source changes unless verification finds a defect.
- PR body records exact test evidence and remaining live-UAT requirement.

**Interfaces:**
- Consumes: verified branch head.
- Produces: draft PR and exact UAT artifact workflow run suitable for live TESSA read-only preview.

- [ ] **Step 1: Compare branch against main**

Run/inspect equivalent of `git diff main...feat/warehouse-v14-runtime` and ensure changes are limited to Warehouse integration, shared composer, tests, workflow wiring, and approved docs.

- [ ] **Step 2: Open a draft PR**

PR title: `feat: add read-only Warehouse v14 preview runtime`

PR body must state:

- business target and fail-closed behavior;
- zero Warehouse-specific writes in this milestone;
- targeted test results;
- full `npm test` result;
- exact production bundle marker result;
- live TESSA preview still required before any mutation milestone.

- [ ] **Step 3: Trigger/inspect UAT Candidate on exact feature ref**

The workflow must build using `tools/build-production-userscript.mjs`, run full tests, create `candidate-manifest.json`, and upload the exact userscript. Confirm workflow conclusion is success before describing the candidate as CI-verified.

- [ ] **Step 4: Inspect exact artifact metadata**

Confirm manifest commit equals the branch head, SHA-256 is present, and the generated userscript contains both `__TMS_WAREHOUSE_V14_KERNEL__` and `__TMS_WAREHOUSE_V14__`.

- [ ] **Step 5: Stop before mutation**

Do not add Warehouse Apply/Store/Delete. The next milestone starts only from live TESSA preview evidence produced by this exact artifact.

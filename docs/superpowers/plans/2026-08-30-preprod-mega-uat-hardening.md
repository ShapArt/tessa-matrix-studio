# Pre-prod Mega UAT Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden large-plan Preview/review, destructive Apply controls, cancellation reporting, and large mixed-load regression coverage before production UAT.

**Architecture:** Keep the existing single-userscript architecture and boundaries. Add pure helpers for preview paging/filtering and batch/delete safety, keep all TESSA writes in the existing safety/apply layer, and expose enough pure logic through test exports so Node regressions can verify behavior without a live TESSA backend.

**Tech Stack:** JavaScript userscript, Node.js regression tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-preprod-mega-uat-hardening-design.md`

## Global Constraints

- Production userscript remains dependency-free at runtime (`@grant none`, no `@require`).
- Preview must remain read-only.
- Apply must repeat fresh preflight.
- Identity ambiguity remains fail-closed.
- Maximum executable mutation actions in one Apply: 2000.
- 501–2000 mutation actions require an extra warning confirmation.
- 100 or more DELETE actions are hard-blocked regardless of ratio.
- Existing ratio DELETE hard-block remains `deleteCount >= 10 && ratio >= 20%`.
- Cancellation never rolls back already completed writes; it must produce exact machine-readable counts.

---

### Task 1: Large-plan Preview navigation and filtering

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/review-large-plan.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `createPreviewViewState()`, `selectPreviewItems(plan, review, viewState)` as pure helpers exposed in test mode.
- UI consumes the selected page but review keys remain derived from original plan actions.

- [ ] **Step 1: Write failing regression**

Create `tests/review-large-plan.mjs` that builds 120 UPDATE actions, requests page 3 at page size 40, asserts action 100 is present, applies a type filter, and verifies review exclusions remain keyed to the original action rather than page position.

- [ ] **Step 2: Run the new test**

Run: `node tests/review-large-plan.mjs`
Expected: FAIL because preview paging/filter helpers do not exist and current UI is hard-limited to the first 40 actions.

- [ ] **Step 3: Implement pure preview helpers**

Add session-only state with `page`, `pageSize`, `filter`, `query`. `selectPreviewItems()` must return `{items,total,page,pageCount,start,end}` without mutating plan/review.

- [ ] **Step 4: Wire UI controls**

Replace the fixed `visible.slice(0, 40)` behavior with helper-driven rendering. Add all/update/add/delete/skip filter controls, previous/next controls and `Показано X–Y из N`. Reset page to 1 when filter/query changes.

- [ ] **Step 5: Run focused tests**

Run: `node tests/review-large-plan.mjs && node tests/review-ui-contract.mjs && node tests/review-undo.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: make large preview fully reviewable`

---

### Task 2: Stronger destructive DELETE guard

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/delete-guard-limits.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `deletionGuard(plan)`.
- Produces: same return shape plus `rule` (`ratio|absolute|null`) and precise `reason`.

- [ ] **Step 1: Write failing regression**

Cover: 99/1000 allowed; 100/1000 blocked by absolute rule; 10/50 blocked by ratio rule; 9/50 allowed.

- [ ] **Step 2: Run focused test**

Run: `node tests/delete-guard-limits.mjs`
Expected: FAIL for 100/1000 because current guard only checks the ratio rule.

- [ ] **Step 3: Implement minimal guard change**

Block when `deleteCount >= 100` OR existing ratio condition is true. Return the triggering rule and readable reason.

- [ ] **Step 4: Run existing delete regressions**

Run: `node tests/delete-guard-limits.mjs && node tests/acceptance.mjs && node tests/overwrite-delete.mjs && node tests/schema-refresh-delete.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `safety: hard block hundred-row deletes`

---

### Task 3: Large Apply batch warning and hard limit

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/apply-batch-limit.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: pure `evaluateApplyBatch(actions)` returning `{count, warning, blocked, reason}`.
- `applyPlan()` calls it after selective review and before creating `TessaBridge`.

- [ ] **Step 1: Write failing regression**

Assert: 500 actions normal; 501 warning; 2000 warning but allowed; 2001 blocked; blocked path creates zero bridge/TESSA calls.

- [ ] **Step 2: Run focused test**

Run: `node tests/apply-batch-limit.mjs`
Expected: FAIL because no batch evaluator exists.

- [ ] **Step 3: Implement evaluator and Apply integration**

Use mutation actions only. For warning range show an extra confirm with the exact count. For blocked range throw a friendly error before bridge creation.

- [ ] **Step 4: Run acceptance tests**

Run: `node tests/apply-batch-limit.mjs && node tests/acceptance.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `safety: bound mutation batch size`

---

### Task 4: Exact cancellation and partial Apply result

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/apply-cancel-result.mjs`
- Modify: `package.json`

**Interfaces:**
- `applyPlan()` result adds `status`, `plannedCount`, `startedCount`, `failedCount`, `notStartedCount`, `cancelled` while preserving existing fields.

- [ ] **Step 1: Write failing regression**

Mock a bridge whose second successful Store sets `APP.abortRequested=true`. Assert Apply returns, rather than losing state through a generic throw, with `status='cancelled'`, `appliedCount=2`, `cancelled=true`, and exact `notStartedCount`.

- [ ] **Step 2: Run focused test**

Run: `node tests/apply-cancel-result.mjs`
Expected: FAIL because current abort path throws `Операция остановлена пользователем.` before a complete result is formed.

- [ ] **Step 3: Implement cancellation-aware loop exit**

Before each next mutation, detect abort and stop scheduling subsequent mutations. Preserve successful/skipped/failed entries and finalize/download the result JSON.

- [ ] **Step 4: Preserve error semantics**

Per-row Store/Delete failures remain partial failures, dependent DELETE remains blocked if prerequisite was unsuccessful, and unexpected outer errors still generate error reports.

- [ ] **Step 5: Run Apply safety regressions**

Run: `node tests/apply-cancel-result.mjs && node tests/apply-dependent-delete.mjs && node tests/apply-add-race.mjs && node tests/apply-delete-race.mjs && node tests/apply-version-race.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: report exact cancelled apply boundary`

---

### Task 5: Mega mixed-load regression

**Files:**
- Create: `tests/mega-mixed-load.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes existing XLSX/export/import/planner helpers and new safety helpers.
- Does not write to live TESSA.

- [ ] **Step 1: Build deterministic fixture generator**

Generate 500, 1000 and 5000-row snapshots with stable IDs and ScenarioID-like display values. Create mixed workbook mutations deterministically.

- [ ] **Step 2: Assert exact mixed counts**

For the 1000-row set include NOOP, UPDATE, ADD, intentional SKIP and a small number of DELETE below destructive limits. Assert exact counts and no unexpected operation types.

- [ ] **Step 3: Exercise large Preview selection**

Verify an operation beyond index 100 can be selected through page/filter helpers and excluded without changing unrelated actions.

- [ ] **Step 4: Exercise operational ceilings**

Verify planner can analyze 5000 rows while `evaluateApplyBatch()` blocks a synthetic 2001-mutation Apply.

- [ ] **Step 5: Add broad performance ceilings**

Use the existing philosophy: ceilings detect hangs/super-linear regressions, not SLA. Keep total runtime under 60 seconds on standard CI and heap growth under a broad bound.

- [ ] **Step 6: Run load regressions**

Run: `node tests/mega-mixed-load.mjs && node tests/xlsx-load.mjs && node tests/xlsx-high-cardinality.mjs && node tests/dictionary-high-cardinality.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `test: add mega mixed-load regression`

---

### Task 6: Documentation and release metadata

**Files:**
- Modify: `README.md`
- Modify: `docs/PRODUCTION-RUNBOOK.md`
- Modify: `CHANGELOG.md`
- Modify: `tessa-matrix-studio.user.js`
- Modify: `package.json`

**Interfaces:**
- Documentation must match exact thresholds implemented in code.

- [ ] **Step 1: Document large Preview behavior**

Explain paging/filtering and that all effective operations remain reviewable.

- [ ] **Step 2: Document operational Apply ceilings**

State 501–2000 warning, >2000 hard block, and DELETE >=100 hard block.

- [ ] **Step 3: Document cancellation semantics**

Explicitly state cancellation is not rollback and the JSON result records applied/skipped/failed/not-started counts.

- [ ] **Step 4: Bump patch version consistently**

Update userscript metadata, `APP.version`, package version, README and changelog to the new patch version.

- [ ] **Step 5: Run docs/release regressions**

Run: `node tests/docs.mjs && node tests/release-workflow.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `docs: document mega UAT safety limits`

---

### Task 7: Full verification and PR

**Files:**
- No new product files unless verification exposes a regression.

- [ ] **Step 1: Run syntax check and full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Review diff against production invariants**

Verify Preview remains read-only, TESSA API calls remain in bridge/safety layers, no destructive fallback was added, and existing XLSX security ceilings remain unchanged.

- [ ] **Step 3: Open pull request**

Create PR from `feat/preprod-mega-uat-hardening` to `main` with summary, risk notes, exact safety thresholds and test evidence.

- [ ] **Step 4: Inspect CI**

Confirm Tests/CodeQL results for the PR head. If a job fails, inspect logs, fix on the feature branch, rerun and repeat until green.
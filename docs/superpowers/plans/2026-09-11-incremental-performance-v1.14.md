# Incremental Performance v1.14 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TESSA Matrix Studio perform local/incremental planning, touched-only server validation and read-back, richer employee labels in Excel, and reviewed-change export without weakening fail-closed safety.

**Architecture:** Keep the current single-userscript architecture. Add a tab-local session cache and row fingerprint index around the existing APP/bridge/planner boundaries; use a safe fallback to the current full-snapshot path whenever freshness cannot be proven. Build employee display/resolution and review-export as presentation/XLSX features on top of stable RoleID and planner operations.

**Tech Stack:** userscript JavaScript, TESSA CardService bridge, SpreadsheetML/ZIP helpers already in `tessa-matrix-studio.user.js`, Node.js regression tests, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-11-incremental-performance-v1.14.md`

## Global Constraints

- Production `v1.13.0` stays untouched until the feature branch passes all gates.
- Matrix snapshot cache is memory-only per tab.
- Existing dictionary persistent cache remains separate.
- Any uncertain freshness/identity condition falls back to full safe validation or blocks; never guesses.
- Cross-matrix replacement, unsaved-editor guard and verified read-back semantics must not regress.
- Follow RED → GREEN for every behavioral change.

---

### Task 1: Performance telemetry and session-cache primitives

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/performance-telemetry.mjs`
- Create: `tests/session-matrix-cache.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `performanceStage(name, fn, meta?)`, `performanceSnapshot()`.
- Produces `MatrixSessionCache` helpers: `sessionContextKey`, `setSessionSnapshot`, `getSessionSnapshot`, `invalidateSessionCache`, `updateSessionRows`.

- [ ] Write tests proving timings are captured without external I/O and cache is scoped by MatrixID+TemplateID.
- [ ] Run tests and confirm RED.
- [ ] Add APP performance/session-cache state and helpers.
- [ ] Instrument snapshot, dictionaries, XLSX read/build, planning, preflight and reconciliation entry points.
- [ ] Add metrics to diagnostics/support report without personal values.
- [ ] Run targeted tests and full `npm test`.
- [ ] Commit.

### Task 2: Incremental row fingerprinting and planner fast path

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/incremental-row-diff.mjs`
- Create: `tests/incremental-large-matrix.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `rowBaselineFingerprint(row, columns)` and `classifyWorkbookRowChange(...)`.
- Planner result includes instrumentation counts: `rowsCompared`, `rowsFullyValidated`, `cacheHits`.

- [ ] Add RED tests for 3000 KEEP+1 ADD, 3000 KEEP+1 UPDATE, physical DELETE, cleared DELETE and copied-row ADD.
- [ ] Verify existing full validation currently touches more than changed rows.
- [ ] Implement cheap fingerprint comparison before dictionary/type resolution for unchanged existing rows.
- [ ] Preserve all current copied-ID lifecycle behavior and duplicate validation.
- [ ] Run existing lifecycle/planner/large-load regressions plus new tests.
- [ ] Commit.

### Task 3: Touched-only preflight and reconciliation with safe fallback

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/touched-only-preflight.mjs`
- Create: `tests/touched-only-reconciliation.mjs`
- Create: `tests/incremental-fallback-safety.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `collectTouchedIdentities(plan)`.
- Produces fast-path decision `incrementalSafetyMode(plan, cacheState)` returning `add-only`, `update`, `delete`, `mixed`, or `full-fallback`.

- [ ] Write RED tests that ADD-only does not perform whole-matrix read, UPDATE reads only selected RowIDs, DELETE reads only selected versions, and stale/ambiguous state falls back safely.
- [ ] Implement touched identity collection and cache-generation checks.
- [ ] Refactor `preflightPlan` to use targeted reads where bridge capabilities permit.
- [ ] Refactor reconciliation to use mutation receipts/touched IDs first.
- [ ] Keep full snapshot path as fallback and preserve cross-matrix atomicity.
- [ ] Run race/stale/cross-matrix/reconciliation suites and full `npm test`.
- [ ] Commit.

### Task 4: Employee `ФИО — должность` projection and tolerant resolver

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/employee-position-excel.mjs`
- Create: `tests/employee-name-resolver.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces normalized employee fields `shortName`, `fullName`, `position`, `department`, `displayName`.
- Resolver accepts exact displayName, shortName or fullName; bare-name ambiguity is an error.

- [ ] Add RED tests for Excel dictionary display, picker display, old bare-FIO workbook compatibility and same-FIO ambiguity.
- [ ] Reuse live MtxRoles projection fields rather than deriving position from text.
- [ ] Render personal-role dictionary captions as `Фамилия И.О. — Должность` when position exists.
- [ ] Add resolver indexes for display/short/full names while preserving RoleID priority.
- [ ] Run dictionary/picker/high-cardinality tests and full suite.
- [ ] Commit.

### Task 5: Export only reviewed changes to Excel

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/changes-report-xlsx.mjs`
- Create: `tests/changes-report-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `createChangesReportXlsxBytes(plan, structure)`.
- Adds UI action `#tms-download-changes` enabled after a valid Preview.

- [ ] Write RED tests for ADD/UPDATE/DELETE/SKIP-only workbook and absence of KEEP.
- [ ] Add `Изменение`, `Excel row`, `Причина` columns and `Детали изменений` sheet.
- [ ] Apply deterministic styles: ADD green, UPDATE yellow, DELETE red, SKIP/error orange/red.
- [ ] Mark workbook metadata as report-only and ensure it is rejected as an Apply source.
- [ ] Wire the button into Preview lifecycle and invalidation.
- [ ] Run XLSX/OPC/UX regression suite and full tests.
- [ ] Commit.

### Task 6: Performance UAT and diagnostics UX

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Create: `tests/performance-uat.mjs`
- Modify: `docs/STUDIO-DIAGNOSTICS.md`
- Modify: `package.json`

**Interfaces:**
- Produces performance UAT summary with scenario timings, total rows, fully validated rows, preflight rows, cache hits/misses.

- [ ] Write RED contract tests for required scenarios.
- [ ] Implement non-destructive synthetic planner scenarios and live touched-only timing hooks where available.
- [ ] Add performance results to diagnostics ZIP.
- [ ] Use one consistent UI/message style with existing Full UAT.
- [ ] Run full UAT contract tests and complete regression suite.
- [ ] Commit.

### Task 7: Release candidate documentation and colleague communication

**Files:**
- Modify only if needed: `README.md`
- Create: `docs/communications/v1.14-colleague-test-message.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `tessa-matrix-studio.user.js`

**Interfaces:**
- Version candidate `1.14.0` only after implementation is complete.

- [ ] Record measured synthetic performance numbers; do not claim live speedup yet.
- [ ] Keep current README layout and real screenshot; add only concise new-button/behavior text if required.
- [ ] Draft colleague message explaining what changed, why it matters, what scenarios to test, and how to report diagnostics.
- [ ] Bump candidate version to 1.14.0.
- [ ] Run `npm test`, CodeQL/Quality workflow and candidate artifact build.
- [ ] Do not merge/release until live TESSA UAT confirms performance and safety.
- [ ] Commit and open PR.

## Self-review

Coverage: cache/performance, touched-only validation, employee positions in Excel, changed-only workbook, performance UAT, README constraint and colleague letter are all assigned. Safety fallbacks, copied-row lifecycle, cross-matrix atomicity and verified read-back are explicitly retained. No task requires replacing the existing single-file architecture or adding runtime dependencies.

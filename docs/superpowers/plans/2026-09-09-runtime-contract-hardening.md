# Runtime Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shipping TESSA Matrix Studio changes that pass synthetic tests but fail on real TESSA row deletion, main-matrix persistence, diagnostics, or post-write verification.

**Architecture:** Keep pure planner/XLSX tests, but add a stateful TESSA contract harness and opt-in native-runtime recorder. DELETE must be verified as a real membership transition, main-card persistence must use a valid changed-card request rather than an empty forced transaction, and release UX must distinguish server-accepted writes from readback verification. Native recorder output is the source of truth for undocumented Cherkizovo-specific request contracts.

**Tech Stack:** Tampermonkey userscript, TESSA Web runtime/CardService, Node.js regression tests, jsdom, GitHub Actions.

**Spec:** Live UAT evidence from `TESSA_Write_Check_1788943568259.json` and `TESSA_Matrix_Support_2026-09-09T08-47-05-640Z.json` (2026-09-09).

## Global Constraints

- Never treat `ValidationResult.isSuccessful` as proof that a row was deleted; membership must change.
- Never use `MtxRouteMatrixRows.RowID/RowRowID` as a row CardID.
- Never overwrite unrelated unsaved user edits.
- Every production bug gets a deterministic regression fixture before a fix.
- CI unit tests are not sufficient to call a build ready for external UAT; undocumented TESSA contracts require a recorded/runtime contract check.
- Diagnostic capture must be opt-in and redact business values by default while preserving operation names, request types, field names, GUID-shaped technical identifiers, row states, and validation outcomes.

---

### Task 1: Turn the 2026-09-09 UAT result into an executable contract fixture

**Files:**
- Create: `tests/fixtures/write-check-delete-divergence.json`
- Create: `tests/live-write-check-contract.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `finalizeApplyResult`, Apply result summary renderer.
- Produces: deterministic assertions for accepted=4, verified=2, divergent DELETE=2 and non-misleading UI copy.

- [ ] **Step 1: Write the failing test** that loads a sanitized fixture with 1 UPDATE, 1 ADD and 2 DELETE operations, all accepted, while both DELETE receipts remain members.
- [ ] **Step 2: Run `node tests/live-write-check-contract.mjs` and verify RED** because current UI says “Запись подтверждена для 4 из 4”.
- [ ] **Step 3: Change result copy** to state separately: server accepted N/M; readback verified X; divergences Y.
- [ ] **Step 4: Run the test and verify GREEN.**

### Task 2: Make DELETE a state transition, not a successful request

**Files:**
- Create: `tests/delete-membership-transition.mjs`
- Modify: `tessa-matrix-studio.user.js`

**Interfaces:**
- Consumes: `TessaBridge.rawMatrixSectionLinks()`, `CardRowState`, mutation receipts.
- Produces: `stageMatrixRowDelete(versionId)` returning the exact section-row identity staged for deletion; DELETE is only `ok` after persistence/readback removes membership.

- [ ] **Step 1: Write a stateful failing test** with a matrix membership section. A fake “successful request” that leaves membership intact must fail.
- [ ] **Step 2: Verify RED** against current `deleteMatrixRow()` custom request behavior.
- [ ] **Step 3: Implement the minimal native-card deletion path**: locate the authoritative `MtxRouteMatrixRows` section row by `RowRowID/versionId`, mark that section row `CardRowState.Deleted`, and never infer CardID from section RowID/RowRowID.
- [ ] **Step 4: Persist the changed main card and read it back; only then mark DELETE `ok`.**
- [ ] **Step 5: Verify GREEN and run existing delete/race/dependency tests.**

### Task 3: Replace the invalid empty forced Store with a real changed-card save

**Files:**
- Create: `tests/main-matrix-save-contract.mjs`
- Modify: `tessa-matrix-studio.user.js`

**Interfaces:**
- Consumes: staged main-card row changes from Task 2.
- Produces: `saveMainMatrixAfterApply()` that sends only changed card state and never cleans it before Store.

- [ ] **Step 1: Write a failing test** asserting that outgoing matrix Store contains the staged Deleted section row and that `clean()` is not called after `removeAllButChanged()`.
- [ ] **Step 2: Verify RED** against v1.12.1, which clones, removes unchanged data, then calls `clean()` and `forceTransaction=true`.
- [ ] **Step 3: Implement minimal changed-card Store**: skip when there are no main-card changes; otherwise clone, `removeAllButChanged()`, retain changed row states, set optimistic version semantics supported by runtime, Store, then refresh the card.
- [ ] **Step 4: Verify GREEN** and preserve parallel-edit guard.

### Task 4: Add a native TESSA interface/operation recorder

**Files:**
- Create: `tests/native-runtime-recorder.mjs`
- Modify: `tessa-matrix-studio.user.js`

**Interfaces:**
- Produces: `collectNativeRuntimeSurface()` and a scoped `NativeOperationRecorder` downloadable JSON bundle.

- [ ] **Step 1: Write failing tests** for sanitized capture of runtime method names, cardModel/editor/control methods, section row states, request/store operation metadata, and before/after membership signatures.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add UI controls** under diagnostics: “Снять интерфейс TESSA”, “Начать запись нативного действия”, “Остановить и скачать”.
- [ ] **Step 4: Recorder must restore every patched method in `finally`** and must not persist business values by default.
- [ ] **Step 5: Verify GREEN.**

### Task 5: Make interval duplicate diagnostics capability-aware

**Files:**
- Create: `tests/interval-diagnostics-capability.mjs`
- Modify: `tessa-matrix-studio.user.js`

**Interfaces:**
- Consumes: `DuplicateValidationError.code === 'duplicate-interval-extractor'`.
- Produces: diagnostics that report “server contract unsupported/broken for this operand topology” instead of treating the whole diagnostic run as a generic failure.

- [ ] **Step 1: Write a failing test** using the exact `LeftOperandExtractor is null` shape from 2026-09-09.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement capability classification and preserve all other checks/results.**
- [ ] **Step 4: Verify GREEN.**

### Task 6: Introduce release gates by test fidelity

**Files:**
- Create: `docs/TEST-STRATEGY.md`
- Create: `tests/test-coverage-contract.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/quality.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: mandatory feature-to-test matrix for XLSX, planner, dictionary lookup, ADD, UPDATE, DELETE, save, refresh, reconciliation, support report, interval diagnostics, and runtime recorder.

- [ ] **Step 1: Write failing coverage-contract test** requiring each write-critical feature to have unit + stateful contract coverage and runtime-recordable evidence.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Add the test strategy/manifest and CI command.**
- [ ] **Step 4: Verify GREEN and run full `npm test`.**
- [ ] **Step 5: Do not publish v1.12.2 until all automated gates are green and one native runtime recorder bundle from the test TESSA confirms DELETE and Save contracts.**

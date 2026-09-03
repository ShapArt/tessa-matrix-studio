# Function Role-Type Dictionaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent values of the wrong TESSA role type (for example departments) from appearing in function pickers that expect another role type (for example personal users), while preserving exact ID/RoleTypeID roundtrip compatibility for existing matrix rows.

**Architecture:** Keep `MtxRoles` as the single server source, but partition its typed entries into per-RoleTypeID catalogs after load. Bind each matrix function to the catalog matching `FunctionType.ID` only when the function type is a known numeric TESSA `RoleType` and `MtxRoles` actually supplied typed entries; otherwise retain the current conservative shared-catalog fallback. `mergeSnapshotIntoDictionaryCatalog` remains the compatibility layer that overlays values already present in the matrix into the selected function catalog, so legacy/current values remain readable even when they do not belong to the normal picker population.

**Tech Stack:** Tampermonkey userscript, vanilla JavaScript, Node.js test runner, GitHub Actions.

**Spec:** `docs/UAT-v1.10.0.md`, user-provided 03.09.2026 diagnostics/XLSX, and official TESSA `RoleType` / Views documentation.

## Global Constraints

- Never choose a role from display text alone when ID/RoleTypeID is available.
- `RoleTypeID` remains part of function-role identity.
- Unknown/non-numeric function types must not be guessed.
- Existing values from the live matrix must remain roundtrip-readable even when they are legacy mismatches.
- No change may bypass duplicate validation or alter the `LeftOperandExtractor` safety behavior.
- Release version must be bumped because published versions are immutable.

---

### Task 1: Reproduce the mixed-role picker bug

**Files:**
- Create: `tests/function-role-type-catalog.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TessaBridge.loadDictionaryCatalog(structure, snapshot, options)` and `mergeSnapshotIntoDictionaryCatalog`.
- Produces: regression coverage proving a Personal function receives Personal roles, a Department function receives Department roles, unknown function types retain fallback behavior, and current live values remain resolvable.

- [ ] **Step 1: Write the failing test**

Create a synthetic `MtxRoles` view with at least:

```js
[
  ['person-1', 'Иванов Иван Иванович', 1],
  ['department-1', 'Юридический департамент', 2],
]
```

Use a structure with `FunctionType.ID` values `1`, `2`, and one unknown/non-numeric value. Assert that the generated function catalogs contain only the matching typed entries for types 1 and 2, while the unknown function keeps the shared fallback. Add a snapshot value with an intentionally legacy mismatching RoleTypeID and assert that the overlay still preserves/resolves that exact `(RoleID, RoleTypeID)` identity.

- [ ] **Step 2: Run the regression before implementation**

Run:

```bash
node tests/function-role-type-catalog.mjs
```

Expected: FAIL because all functions currently map to the same unfiltered `roles:MtxRoles` catalog.

- [ ] **Step 3: Add the test to the full suite**

Append `node tests/function-role-type-catalog.mjs` to the `npm test` chain.

- [ ] **Step 4: Verify the full suite is red for the intended reason**

Run:

```bash
npm test
```

Expected: the new role-type regression fails; pre-existing tests remain otherwise green.

---

### Task 2: Partition the MtxRoles catalog by function role type

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Test: `tests/function-role-type-catalog.mjs`

**Interfaces:**
- Consumes: `structure.functions[].typeId`, role entries with `entry.roleTypeId`, existing `columnCatalogIds` mapping.
- Produces: function-specific catalog mapping such as `roles:MtxRoles:type:1`, without changing role identity or snapshot overlay semantics.

- [ ] **Step 1: Add conservative role-type normalization**

Implement a helper equivalent to:

```js
function knownRoleTypeId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 7 ? number : null;
}
```

Do not infer a type from captions or from another function.

- [ ] **Step 2: Partition only when typed source data exists**

After loading `MtxRoles`, detect whether at least one entry has a valid `roleTypeId`. For each function with a known role type, create/reuse a catalog containing only entries with that exact `RoleTypeID`. Functions with an unknown type, or environments where the role view supplied no role-type metadata at all, keep the existing shared catalog.

- [ ] **Step 3: Keep snapshot overlay unchanged**

Continue calling `mergeSnapshotIntoDictionaryCatalog` after function-to-catalog mapping is established. This deliberately re-adds exact current matrix values to their function catalog, preserving legacy/current rows without offering every wrong-type role as a new choice.

- [ ] **Step 4: Run the focused regression**

Run:

```bash
node tests/function-role-type-catalog.mjs
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run:

```bash
npm test
```

Expected: PASS, zero failures.

---

### Task 3: Version, UAT and operator documentation

**Files:**
- Modify: `tessa-matrix-studio.user.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/UAT-v1.10.0.md`

**Interfaces:**
- Produces: v1.10.2 release metadata and a reproducible live UAT checklist.

- [ ] **Step 1: Bump version to 1.10.2 everywhere enforced by repository tests**

The userscript `@version`, runtime `APP.version`, npm package metadata, README badge/current-version text and bug-report placeholder must all agree on `1.10.2`.

- [ ] **Step 2: Document the behavior**

Add changelog/UAT coverage stating:

```text
Personal (RoleType 1) functions offer users, Department (RoleType 2) functions offer departments; values already present in the matrix remain preserved by exact ID/RoleTypeID even if they are legacy mismatches. Unknown function types remain fail-conservative and are not guessed.
```

Also keep `LeftOperandExtractor is null` listed as a separate unresolved server-side validation blocker; do not imply it was fixed.

- [ ] **Step 3: Run the complete verification suite**

Run:

```bash
npm test
```

Expected: PASS, zero failures.

---

### Task 4: Review, merge and release verification

**Files:**
- GitHub PR `#54`

**Interfaces:**
- Consumes: green branch CI and fresh diff review.
- Produces: merged main and automatically published immutable v1.10.2 release if release workflow succeeds.

- [ ] **Step 1: Verify branch state and CI**

Confirm PR #54 is mergeable, not behind `main`, and `Quality & Security` is green on the final head SHA.

- [ ] **Step 2: Review the final diff**

Check that the functional change is limited to role-catalog partitioning plus tests/version/docs, and that no duplicate-validation bypass or Store/Delete safety change was introduced.

- [ ] **Step 3: Merge only after fresh evidence**

Use squash merge after the final green CI and review.

- [ ] **Step 4: Verify release delivery**

The repository release workflow runs after successful `Quality & Security` on `main`. Verify tag/release `v1.10.2`, public userscript version, and release workflow conclusion. Do not call the work complete if the release workflow fails.

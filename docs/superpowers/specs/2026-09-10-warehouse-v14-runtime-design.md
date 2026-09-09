# Warehouse Logistics v14 — production runtime design

Date: 2026-09-10
Status: design for review
Branch: `feat/warehouse-v14-runtime`

## Goal

Add a Warehouse Logistics migration/preview subsystem to TESSA Matrix Studio and make it part of the exact userscript that is packaged for UAT/release. The subsystem must derive changes from the live TESSA matrix without rebuilding unrelated matrix content and must fail closed whenever identity, directory, site, category, or scope resolution is ambiguous.

The immediate integration milestone is **read + classify + preview only**. No Warehouse-specific mutation path is enabled until the preview kernel, production composition, and live UAT evidence are verified.

## Source priority and scope

Business interpretation follows this priority:

1. current written Warehouse task + `Свод Логистика 12.08.26`;
2. correspondence dated 05.08.2026;
3. earlier material dated 06.07.2026;
4. current OpenText/TESSA matrix only as implementation state, not as authority when it conflicts with the newer task.

Target slice:

- Directorate: `Дирекция Направлений`;
- Function: `Складская логистика`.

The implementation must not alter rows outside the proven Warehouse domain.

## Business transformation invariants

### Current-to-target interpretation

- Slide 10 represents the current/legacy performers used by shared Production/Centralized/Warehouse rules.
- Slide 11 represents the new Warehouse per-site performer rules.
- `Соколов Лев` / `Лев Соколов` is replaced by `Гринкевич Вадим Викторович` only inside the proven Warehouse target scope.
- A presentation typo or abbreviated name is never enough for APPLY. Runtime directory resolution must find one exact intended TESSA performer; zero or multiple matches block the plan.

### Signing ranges

Ordinary Warehouse categories:

- 0–5 млн: responsible Warehouse Logistics employee for the site;
- 5–10 млн: Warehouse Logistics manager for the site;
- 10–50 млн: Гринкевич Вадим Викторович;
- 50–100 млн: Бутенко;
- >100–400 млн: Субботин.

VGO signing:

- Revenue 0–5 млн: responsible site employee;
- Revenue 5–10 млн: site manager;
- Revenue 10–100 млн: Желтоногов;
- Revenue >100 млн: Субботин;
- Expense 0–10 млн: Желтоногов;
- Expense >10 млн: Динер.

Special-expert routing is handled independently from signing and must not be accidentally merged into the signing transformation.

### Site slicing vs global performers

Only site-bound roles are expanded/sliced by site:

- responsible Warehouse Logistics employee for the site;
- Warehouse Logistics manager for the site;
- VGO/SГП site-group manager where the source explicitly requires site scope.

Global Warehouse performers such as Гринкевич, Бутенко, Субботин, Желтоногов and Динер keep the broadest **proven** Warehouse legal-entity/OP scope from the legacy matrix. They must not be exploded into 28 copies just because there are 28 site mappings.

### Category normalization

The business list may contain 11 logical categories while TESSA/OpenText can expose 10 system categories because:

- `ТО и ремонт оборудования для склада`
- `ТО и ремонт спец. техники для склада`

may map to the single system category `ТО, ремонт оборудования и техники для склада`.

This collapse is explicit configuration, never fuzzy matching.

## Lossless transformation model

The migration is **PATCH-first** rather than rebuild-first.

For every legacy row that mixes Warehouse with Production/Centralized scope:

1. identify the exact Warehouse-covered subset;
2. preserve the original row identity for the largest safe residual/target piece when possible;
3. subtract only the Warehouse subset being reassigned;
4. preserve all non-Warehouse legal entities, OPs, categories, numeric conditions, technical criteria and unrelated performers exactly;
5. create an ADD only for a residual/target piece that cannot reuse an existing row identity;
6. prove that split pieces form a disjoint cover of the original semantic scope.

No change may broaden the route beyond the source row’s proven scope. Empty matrix criteria remain wildcard/no restriction; multi-values remain OR; multiple matching rows can merge routes, so accidental overlap is treated as a blocker rather than tolerated.

## Architecture

### 1. Pure planning kernel — `warehouse-logistics-v14.cjs`

Responsibilities:

- normalize Warehouse configuration and live matrix facts;
- classify rows as target, shared legacy, unrelated, ambiguous, or unsupported;
- resolve category/site/performer scope using exact configured aliases only;
- produce a deterministic preview plan;
- prove transformation invariants: disjointness, scope preservation, no unrelated changes, no implicit wildcard broadening;
- return blockers instead of guessing.

Inputs are plain serializable facts; there is no browser/TESSA dependency and no write API.

Output shape:

```text
{
  status,
  summary,
  actions: [PATCH | SPLIT | ADD | NOOP],
  blockers,
  evidence
}
```

The first milestone does not translate these actions into TESSA Store/Delete calls.

### 2. Browser adapter/runtime — `warehouse-v14-runtime.js`

An appended IIFE consumes the stable public seam already exposed by the main userscript:

`window.__TESSA_MATRIX_SYNC_EXPORTS__`.

It uses at least:

- `TessaBridge.create()`;
- `bridge.requestStructure(bridge.templateId())`;
- `bridge.loadSnapshot(structure)`;
- canonical normalization helpers exported by the main userscript.

Responsibilities:

- verify that the active card is a writable/readable route matrix with the expected target slice available;
- convert `structure + snapshot` into the plain fact model expected by the kernel;
- expose a Warehouse v14 diagnostic/preview API under a unique marker such as `window.__TMS_WAREHOUSE_V14__`;
- return preview/blockers only in the first milestone;
- never call Store/Delete for Warehouse-specific actions.

If the base Studio exports are missing or incompatible, runtime fails closed with a clear compatibility error.

### 3. Production composition

Warehouse runtime must be included in every exact artifact path, not merely exist as a source file.

The current UAT workflow builds the shipped file by composing:

`root userscript -> malformed-range transform -> version rewrite -> interval fallback append`.

The Warehouse runtime must be appended by the same production composition used for UAT and Release. To prevent future drift, composition should move to one reusable build script invoked by both workflows instead of duplicating shell concatenation logic.

The built `dist/tessa-matrix-studio.user.js` must contain and syntax-check the Warehouse marker.

## Fail-closed rules

Preview receives `blocked` status when any required decision is not uniquely supported, including:

- active matrix/template mismatch;
- missing Warehouse directorate/function;
- ambiguous or missing performer identity;
- ambiguous site -> legal entity/OP mapping;
- category not represented by an explicit configured system mapping;
- shared legacy row cannot be split without broadening or losing residual scope;
- overlapping target pieces would cause route multiplication;
- a row would lose unrelated criteria/roles/technical values;
- source facts are incomplete enough that disjoint-cover proof cannot be made.

No fuzzy identity matching is allowed for a plan that could later become APPLY-capable.

## Testing strategy

Development is RED -> GREEN.

### Kernel tests

Required permanent fixtures cover:

- Sokolov -> Grinkevich in Warehouse scope while preserving non-Warehouse residuals;
- shared row split with exact disjoint cover;
- global performers remain compact instead of 28-site explosion;
- site-bound 0–5 and 5–10 ranges are sliced correctly;
- VGO revenue and expense thresholds remain separate;
- special expert route remains independent;
- explicit 11-business -> 10-system category collapse;
- wildcard/OR semantics are not broadened;
- ambiguous site/category/performer blocks;
- input order does not change plan output;
- running planner against already-target state yields NOOP/idempotent preview.

### Browser adapter tests

- production export seam is detected;
- `TessaBridge` snapshot is converted to kernel facts without mutation;
- compatibility mismatch blocks cleanly;
- first milestone exposes no Warehouse Store/Delete callable.

### Production bundle contract

A regression test builds or inspects the exact UAT/release composition and requires:

- main Studio marker/version;
- interval fallback marker;
- malformed numeric-range transformation marker;
- Warehouse v14 marker;
- `node --check` success on the exact composed userscript.

This test exists specifically to prevent the already-observed failure mode where source/kernel tests pass but the installed `.user.js` does not contain Warehouse functionality.

### Verification before PR completion

1. targeted kernel + runtime tests;
2. production bundle contract;
3. full `npm test`;
4. UAT Candidate workflow on the exact feature-branch ref;
5. inspect candidate manifest/SHA and confirm Warehouse marker in the generated exact artifact;
6. only after live TESSA read-only preview is captured may mutation design be proposed as a separate milestone.

## Non-goals for this milestone

- No automatic Warehouse APPLY.
- No generic matrix refactor unrelated to Warehouse integration.
- No fuzzy employee/site/category resolution.
- No rewrite of existing generic TESSA CRUD semantics.
- No automatic merge to `main`.

## Acceptance criteria

The milestone is complete when a branch artifact built by the same production path used for shipment contains Warehouse v14, opens against a live TESSA matrix, reads the target slice, and produces a deterministic preview with explicit blockers and zero Warehouse-specific writes. The exact artifact must pass the full repository test suite and UAT Candidate packaging checks.

# Production-safe Import, Picker and UAT Spec

## Goal

Turn TESSA Matrix Studio into a production-safe matrix transport and diagnostic tool that can:

- import a roundtrip Excel from another card of the same matrix template as an explicit, user-confirmed replacement of the opened matrix;
- remain fail-closed for another template, ambiguous identity, stale server state, invalid dictionaries, failed writes and incomplete cleanup;
- make dictionary-backed editing usable at high cardinality, including FIO collisions, position-aware selection and bulk paste/collect;
- filter the legal-entity dictionary for the «Ведение дела производства» use case by the TESSA source flag «Да» instead of exporting irrelevant legal entities;
- remove circular TESSA runtime objects from DTO/cache/export boundaries;
- materially reduce export/import time for large matrices without weakening workbook integrity/security checks;
- provide one-button reproducible Full UAT in any writable matrix, with native recording, positive write scenarios, negative/error scenarios, cleanup and one diagnostic ZIP.

## Product constraints

1. Production writes remain possible only in a writable TESSA draft and with the already-proven native CardService/editor contracts.
2. No VBA, ActiveX, Office add-in or external executable is introduced. Generated Excel stays ordinary `.xlsx`.
3. A workbook from a different `TemplateID` is never imported as a replacement.
4. A workbook from a different `MatrixID` but the same `TemplateID` is not silently applied. It becomes an explicit transfer/replacement candidate and requires a dedicated confirmation before Apply.
5. Replacement semantics are defined by the desired final row set, not by blindly reusing foreign MatrixRowID/MatrixVersionID values.
6. Foreign row identity and baseline identifiers are never used as CardID or as update/delete targets in the opened matrix.
7. During replacement, current target data must not be deleted before the desired replacement set is proven valid and written. A failed ADD phase must leave the old target rows intact; successful temporary ADDs from a failed phase must be compensating-deleted where possible and reported if cleanup is incomplete.
8. Existing identical target rows may be retained as semantic NOOPs instead of delete+re-add. This is equivalent final state and avoids duplicate conflicts.
9. Cross-matrix schema drift is visible. Columns removed from the current TESSA structure are archive-only and not written. Current columns absent from Excel are empty/default for new replacement rows, not described as “preserved”; server/preflight validation decides whether the row is legal.
10. Runtime TESSA objects (`Card`, controls, EventHandler, MobX models, services) do not cross JSON/cache/Excel/report DTO boundaries. DTOs contain plain scalar/array/object data only.
11. FIO is not a unique employee key. Employee entries use stable ID as identity and display enough disambiguation, at minimum `ФИО — должность`; organization/department may be added when available.
12. Bulk value collection is deterministic. Paste/newline/semicolon separated values are resolved independently, exact matches first; unique normalized matches next; unresolved and ambiguous tokens are reported and never guessed.
13. The legal-entity production-recordkeeping filter is source-driven. The exact TESSA projection field for «Ведение дела производства» must be discovered and asserted in diagnostics/tests before filtering is enabled. If the flag is unavailable or cannot be interpreted, Studio must report that the filter was not applied rather than silently hiding entities.
14. Large-workbook optimization must not remove the actual Excel coordinate limits, ZIP integrity checks, duplicate-coordinate checks or malformed XML checks. Performance work may change representation and loading strategy, not correctness/security invariants.
15. Full UAT may write only after a separate explicit confirmation and only to the currently opened writable matrix. It may create temporary rows, but it must track every created identity and run cleanup in `finally`.
16. Full UAT must be reproducible through a recorded random seed. The ZIP must include the seed and enough input/state metadata to replay the same candidate-selection decisions.
17. Negative UAT scenarios must not perform destructive real server writes. Transport failures are tested with scoped fault injection around the client adapter; invalid Excel/user-input cases must fail before Store/Delete.
18. Full UAT is not a release substitute. Existing exact-artifact native-evidence release gating remains in force.

## External platform facts informing the design

TESSA documents the card flow as a client/server API where requests pass through client and server extension chains and are serialized across the boundary. This supports keeping Studio-side plain DTOs separate from live UI/card objects and treating native service calls as an explicit boundary.

TESSA documentation also exposes reference/autocomplete controls and storage/typed-JSON APIs. Studio should inspect the actual runtime control/source metadata when auditing picker bindings rather than infer a dictionary solely from a visible caption.

For Excel, ordinary Data Validation list dropdowns are the portable `.xlsx` mechanism. Excel also has general cell AutoComplete behavior, but it is not a reliable cross-version substitute for Studio's own searchable picker. Therefore guaranteed type-ahead is implemented in Studio UI; generated Excel continues to receive valid list/named-range validation where practical, without macros.

## Subprojects

### A. Cross-matrix transfer / replacement

A roundtrip workbook is classified into one of four contexts:

- `same-matrix`: current behavior, identity-based merge/update/delete;
- `previous-version`: current supported lineage behavior;
- `same-template-foreign-matrix`: new replacement candidate;
- `foreign-template`: blocked.

For `same-template-foreign-matrix`, build a replacement final-state plan:

1. Convert every non-empty desired Excel row to a foreign-identity-free desired row DTO.
2. Build semantic keys using current structure and resolved stable reference/role IDs.
3. Match each desired row to at most one semantically identical current target row. Unique match becomes NOOP/KEEP.
4. Unmatched desired rows become ADD.
5. Unmatched current target rows become replacement DELETE.
6. Any duplicate/ambiguous semantic set, invalid required role state, unresolved dictionary entry, mapping error, stale target snapshot or server duplicate/preflight failure prevents destructive replacement.

Before Apply, show a dedicated confirmation with source MatrixID/name, target MatrixID/name, counts for KEEP/ADD/DELETE/SKIP, schema drift and a warning that target contents will be replaced. The ordinary Apply confirmation is not sufficient.

Apply replacement in phases:

- phase 0: fresh preflight of all desired mutations and target fingerprints;
- phase 1: ADD replacement rows and verify their Store results;
- if phase 1 fails: do not execute replacement DELETE; compensating-delete any rows created by this run; reconcile and report cleanup;
- phase 2: execute target-only DELETEs;
- phase 3: native matrix save, native view refresh and full semantic reconciliation against the desired final set.

A partial DELETE phase is reported as divergent/superset, never as success.

### B. Dictionary DTOs, picker UX and bulk collection

Introduce an explicit plain dictionary DTO contract:

- catalog: `id`, `label`, `sourceView`, `projection`, `filter`, `entries`, `stats`;
- entry: stable `id`, display text, normalized search text, optional `position`, `organization`, `department`, `roleTypeId`, and source flags required for filtering;
- no Card/control/EventHandler/service references.

All cache, XLSX, diagnostics and refresh paths validate/sanitize through this contract before serialization. A regression fixture contains an intentional `fieldChanged -> _sender -> object` cycle and must still refresh because the cyclic runtime object is discarded before DTO creation.

Picker redesign:

- header shows column, logical type, dictionary source and result count;
- search is immediate type-ahead;
- selected values render as removable chips;
- employee result label defaults to `ФИО — должность`, optionally with organization/department when duplicate FIO+position remains;
- stable ID, not display string, is stored in hidden selectors;
- ambiguous same-FIO results remain separate;
- technical GUID/source metadata is hidden behind diagnostics/details.

Bulk «Собрать значения»:

- accepts newline, semicolon and copied-column input;
- Enter starts resolution for the full input;
- exact ID / exact full display / exact `ФИО — должность` matches are selected automatically;
- a unique normalized FIO may be accepted only when exactly one employee exists;
- ambiguous and missing tokens are returned in separate lists with candidate suggestions;
- no token is silently dropped;
- user can accept all resolved values in one action.

Generated Excel:

- keeps ordinary Data Validation/named ranges for manageable embedded dictionaries;
- no VBA/ActiveX is used;
- Studio-side type-ahead is the guaranteed autocomplete path;
- high-cardinality catalogs may use a thinner embedded representation while import-time resolution still validates every value against the live/current catalog.

### C. Legal-entity production-recordkeeping filter

For columns whose source is the legal-entity catalog used by «Ведение дела производства»:

1. Discover the source view projection and the exact flag field/caption returned by TESSA.
2. Normalize yes-values using TESSA Boolean semantics (`true`, `1`, localized `Да`) only after the projection is proven.
3. Filter the catalog before cache/XLSX generation so irrelevant legal entities are never materialized in the exported selector list.
4. Diagnostics record source count, accepted count, rejected count, source field and whether filtering was confidently applied.
5. If source metadata does not expose the flag, do not guess by organization name or position; emit `filter-not-proven` and leave the catalog unfiltered until configured/proven.

### D. Large matrix performance

First add stage timings and size counters to diagnostics: structure, snapshot, per-catalog load, catalog normalization, grid build, XML parts, ZIP compression, final bytes, parse, dictionary refresh and preview matching.

Optimization order:

1. Reuse normalized catalog cache when structure signature is unchanged; force-refresh only on explicit user action/UAT.
2. Ensure each logical catalog is loaded/exported once even if several columns reference it.
3. Apply source-side/local proven filters before building entry search indexes or XLSX XML.
4. Keep only DTO fields required by editing/search in the workbook representation.
5. Avoid repeated full-array sorts/index builds for every cell/column; build lookup indexes once per catalog.
6. For very high-cardinality catalogs, use a thin-workbook strategy based on estimated serialized bytes rather than rejecting the workbook. The workbook remains importable; live Studio resolution supplies the authoritative full catalog during Preview.
7. Only if profiling still shows UI blocking after representation fixes, move CPU-heavy pure XLSX XML/ZIP work behind cooperative yielding/worker support as a separate follow-up.

Performance acceptance is measured comparatively on fixed synthetic fixtures and with stage telemetry on the real large matrix. CI should assert operation counts/representation size and avoid flaky wall-clock thresholds; live UAT records actual elapsed timings.

### E. Full UAT Runner and single ZIP

Add `Полный UAT с записью` next to current read-only diagnostics. It is a distinct write-capable mode.

Preflight:

- require writable draft, runtime capabilities, current matrix/template identity and safe native editor/service methods;
- capture original snapshot and section signature;
- generate/record deterministic seed;
- start native recorder before first write;
- show explicit confirmation that temporary test rows will be created and removed.

Scenario groups:

1. Environment/runtime surface.
2. Every-column binding audit: Excel header -> schema token -> criterion/function -> operand -> expected catalog -> column catalog -> picker catalog -> resolved test cell catalog.
3. Dictionary refresh, DTO serialization and circular-object regression probe.
4. Picker open/search/select/reopen for each dictionary-backed column.
5. Positive temporary write flow: clone a random valid source row into UAT row A; ADD -> readback; change one safely editable random field to another live dictionary value -> UPDATE -> readback; clear one optional field -> UPDATE -> readback.
6. UAT row B: ADD -> readback -> model physical Excel-row removal -> DELETE -> verify absence.
7. Duplicate scenario: prepare an exact duplicate and prove duplicate/preflight rejection without Store.
8. Negative user-input scenarios: invalid dictionary token, ambiguous employee FIO, invalid boolean, invalid number/interval, reversed interval, formula/coercion, removal of last required role, stale version, wrong matrix, wrong template, duplicate hidden ID.
9. Scoped fault injection: timeout/error/incomplete response for Get, duplicate-check, Store, DeleteRow, refresh and reconciliation; assert UI/accounting/reporting never reports false success.
10. Cleanup in `finally`: delete every UAT-created row still present, native save, refresh and final snapshot comparison.

UAT final status:

- `PASSED`: all required scenarios passed and cleanup verified;
- `FAILED`: one or more functional assertions failed but cleanup verified;
- `UNSAFE`: cleanup could not prove removal of all UAT-created rows or matrix context changed;
- `INCOMPLETE`: user cancelled/page interrupted/required runtime capability unavailable before destructive work.

One ZIP contains `summary.json`, `uat-report.json`, `timeline.json`, native trace, runtime surface, dictionary audit, column binding audit, picker audit, scenario details, mutation receipts, reconciliation, cleanup report, performance timings, ordinary diagnostics summary and a human-readable README. Every failed check includes an ID, stage, column/Excel row when applicable, expected/actual, error classification and write-attempted flag.

## Release / rollout strategy

These changes must not land as one production PR. Recommended order:

1. Finish and live-test the current XLSX row/cell ceiling hotfix independently.
2. Cross-matrix replacement + confirmation + phased apply/compensation.
3. Plain dictionary DTO boundary + circular refresh bug + picker/bulk-resolution UX + employee disambiguation.
4. Proven legal-entity filter + large-catalog representation/performance telemetry and optimization.
5. Full UAT runner + ZIP + self-tests/fault injection.
6. Exact-artifact live UAT and existing native evidence release gate before the first release containing all components.

Each PR must include RED proof, focused regression tests, full `npm test`, CodeQL/high-critical gate, and no weakening of the release evidence workflow.

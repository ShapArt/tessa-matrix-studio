# TESSA Matrix Studio v1.9.35 — Gold Candidate

Status document for PR #46. The implementation plan remains the historical step-by-step execution record; this file records the actual release gate state after implementation and live MAX UAT.

## Automated gates — complete

- Large Preview is fully reviewable: paging, operation filters, search, selective review beyond the first 40 actions.
- UPDATE supports whole-row and per-field exclusion; ADD and DELETE support whole-operation exclusion and restore.
- Apply operational limits are enforced: `<=500` normal, `501–2000` extra confirmation, `>2000` hard block.
- v1.9.35 exposes the `>2000` block before click: disabled Apply, current/max count and inline reason; the internal `applyPlan()` guard remains defense-in-depth.
- DELETE safety is enforced: `>=100` absolute hard block plus the existing `>=10 && >=20%` ratio guard.
- Stop/cancel accounting is explicit and machine-readable; cancellation is not rollback.
- Post-Store refresh failure preserves reconciliation evidence and forbids blind retry.
- Large blocked Preview uses a local ADD fast path; any actually applicable package still receives fresh server preflight before Store.
- SpreadsheetML self-closing empty rows are accepted while genuine row/cell coordinate corruption remains fail-closed.
- Race, baseline identity, XLSX ZIP/XML/OPC, legacy V1–V5, 500/1000/5000 load and high-cardinality regressions are in the full suite.
- External GitHub Actions are pinned to full SHAs; Dependabot maintains those pins.

The exact automated evidence must always be taken from the latest PR head and its `Quality & Security` run, not from an older SHA copied into this document.

## Live evidence already obtained

The v1.9.34 MAX browser run confirmed the real TESSA path can:

- parse 56 Excel columns and 8636 data rows;
- load a structure with 18 criteria / 8 functions;
- load a 135-row TESSA snapshot;
- build an 8505-operation Preview plus 4 expected SKIP rows over 213 pages;
- fail closed on the prepared clear-row, unknown-dictionary, duplicate and dependent-delete cases;
- block the oversized package before Store.

That run exposed one UX defect: the known `>2000` policy block was still clickable and therefore surfaced as a modal/ErrorReport. v1.9.35 fixes that exact behavior and has an automated regression reproducing `8505 executable + 4 SKIP`.

## Manual gates before gold release

1. **Browser/Tampermonkey recheck of `APPLY-BLOCK-UX-001` on v1.9.35.** The 8500-row MAX master must leave Preview usable while Apply is disabled before click. No policy-block modal and no `TESSA_Matrix_ErrorReport_*.json` may be produced.
2. **Controlled live Apply from a fresh derived package.** Use a small package (`<=500` recommended), confirm expected Preview, apply, then download a fresh matrix and reconcile the result. Do not Apply the 8500-row master.
3. **Release Immutability.** Enable GitHub Release Immutability in repository `Settings -> Releases` before publishing the production release, then verify the published tag, assets and checksums.

If any P0 live gate fails, keep PR #46 draft and do not publish.

## Accepted residual risks / deferred work

These are not reasons to destabilize v1.9.35 immediately before release:

- The userscript is still a large single file. Modular build/refactor is a separate post-gold engineering task.
- `@include https://tessa-app*.cherkizovsky.net/*` is broader than the explicit host list. Tighten it only after an approved production host inventory exists.
- Custom DELETE has a documented client-side micro-window between its final targeted recheck and the custom delete request; there is no equivalent server-side `AffectVersion` lock in this flow.
- SpreadsheetML resource ceilings intentionally fail closed; practical maximum row count depends on workbook width and the 500k parsed-cell ceiling.
- Full automated browser-extension E2E against internal TESSA is not part of the current Node/CI harness. The MAX workbook is the browser/live-TESSA release gate.
- `renderPlan()` performs linear review/duplicate validation for the full plan. No super-linear path was found; optimize only if live v1.9.35 profiling shows visible UI latency.

## Release rule

Do not merge/release because a previous run was green. Re-verify the exact PR head immediately before integration. The release workflow runs the full suite again on `main`, refuses to overwrite an existing version/tag mismatch, builds checksum/provenance assets and verifies public `latest` delivery.
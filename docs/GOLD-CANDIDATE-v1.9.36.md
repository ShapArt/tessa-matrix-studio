# TESSA Matrix Studio v1.9.36 — Gold Candidate

Status document for PR #46. Automated evidence must always be read from the latest PR head and its `Quality & Security` run; copied SHAs in prose are not release authority.

## Automated gates — complete

- Large Preview is fully reviewable: paging, type filters, search and selective review beyond the first 40 actions.
- UPDATE supports whole-row/per-field exclusion; ADD and DELETE support whole-operation exclusion/restore.
- Large Preview can be reduced through **«Пакет для Apply»** to `1 / 10 / 100 / 500 / 2000` operations. Selection follows both the active type filter and active Preview search; **«Вернуть всё»** restores the source review state.
- Apply limits remain defense-in-depth: `<=500` normal, `501–2000` extra confirmation, `>2000` hard block both in Preview availability and inside `applyPlan()`.
- DELETE safety remains `>=100` absolute hard block plus `>=10 && >=20%` ratio guard; the redundant DELETE-only browser confirm is intentionally absent.
- Stop/preflight cancellation, partial-result accounting, refresh-after-Store recovery, race guards, baseline identity and XLSX ZIP/XML/OPC protections remain in the full regression suite.
- Large blocked Preview uses the local ADD fast path; every package that is actually allowed to Apply still receives fresh server preflight before Store.
- External GitHub Actions remain pinned to full SHAs and maintained by Dependabot.

## Live evidence already obtained

The real browser/Tampermonkey/TESSA MAX runs confirmed:

- v1.9.34 parsed the 56-column / 8636-row MAX workbook, loaded 18 criteria / 8 functions and a 135-row TESSA snapshot, and built 8505 executable operations + 4 expected SKIP over 213 Preview pages;
- prepared clear-row, unknown-dictionary, duplicate and dependent-delete cases stayed fail-closed;
- the >2000 safety ceiling prevented Store;
- v1.9.35 fixed the discovered UX gap: on the same 8505-operation MAX, Apply is disabled before click, `8505 / 2000` is visible, Preview remains usable, and no policy-block modal/ErrorReport is produced.

## Remaining manual gates before gold release

1. **Controlled live Apply on v1.9.36.** Start from a fresh export. On the MAX/derived test flow use the Preview filter/search plus **«Пакет для Apply»** to leave a very small package (recommended `1–10` safe ADD/UPDATE operations, no DELETE for the first proof). Confirm the effective counters, Apply once, preserve the result JSON, then download a new fresh export and reconcile the changed rows. Do not Apply the 8500-row master as-is.
2. **Release Immutability.** Enable GitHub Release Immutability in repository `Settings -> Releases` before publishing, then verify the published tag/assets/checksums/attestation.

If the controlled live Apply fails a P0 invariant, keep PR #46 draft and do not publish.

## Accepted residual risks / deferred work

- The userscript is still a large single file; modular build/refactor is a post-gold task.
- `@include https://tessa-app*.cherkizovsky.net/*` stays until an approved production host inventory exists; runtime still requires TESSA API/webpack presence before mounting.
- Custom DELETE retains the documented client-side micro-window between final targeted recheck and custom delete request because this path has no server-side `AffectVersion` equivalent.
- SpreadsheetML limits intentionally fail closed; practical maximum rows depend on workbook width and the parsed-cell ceiling.
- Full automated browser-extension E2E against internal TESSA is not available in the Node CI harness; controlled live UAT remains the final integration proof.

## Release rule

Re-verify the exact PR head immediately before integration. After the controlled live Apply passes: mark PR ready, merge to `main`, let the release workflow rerun the full suite/build/checksums, publish v1.9.36 only once, then verify the immutable release and Tampermonkey `latest` delivery.

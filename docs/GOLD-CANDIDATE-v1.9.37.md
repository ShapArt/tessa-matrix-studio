# TESSA Matrix Studio v1.9.37 — Gold Candidate

Status document for PR #46. Release authority is the exact PR head and its latest `Quality & Security` run.

## Exact automated evidence

- Candidate head: `8864df4fd4faeb144357591378ac3cef8383033d`.
- Quality & Security run: `33384630549`.
- Tests: success.
- CodeQL: success.
- Existing large Preview/package-builder, destructive guards, cancellation/result accounting, XLSX security, race guards, legacy/load/high-cardinality regressions remain green.
- `apply-refresh-failure-result.mjs`: successful Store does not force `editor.refreshCard()` / native matrix-view reload.
- `apply-report-opt-in.mjs`: Apply/ErrorReport JSON is not automatically downloaded; manual report download remains available.
- `apply-plan-consumed.mjs`: any started mutation consumes the old plan/snapshot/bridge; a pre-write cancellation keeps the safe reviewed plan.

## Live evidence that produced v1.9.37

The v1.9.36 live Apply completed 13 operations successfully (12 UPDATE + 1 DELETE): `status=completed`, `success=true`, `appliedCount=13`, `failedCount=0`, `notStartedCount=0`.

After the successful writes, native TESSA twice showed an error while loading `TestMatrixView / MtxRouteMatrixDummyView`: HTTP 400 with `ObtainWriterLock for MatrixRow.WriteHeartbit... fail`. The userscript at that point unconditionally called `editor.refreshCard()` after Store/Delete. v1.9.37 removes that forced refresh. This does not suppress a Store error: the Store result is finalized first, and the next state read is explicitly started by the user through a fresh export/reload.

The same live session also confirmed that automatic Apply JSON downloads are unnecessary noise for normal users. v1.9.37 keeps the latest diagnostic report in memory and exposes **«Скачать отчёт»** only as an explicit user action.

## Remaining live gold gate

Run one small safe ADD/UPDATE on v1.9.37 from a fresh Preview and confirm all of the following in the same run:

1. Store completes successfully.
2. No automatic native card refresh is initiated by Studio and no `TestMatrixView / WriteHeartbit` popup appears after Store.
3. Downloads receives no JSON automatically.
4. **«Скачать отчёт»** manually produces the last report when requested.
5. The old Apply plan is no longer reusable after the started mutation.
6. A fresh export contains exactly the intended change and no unexpected neighboring changes.

If any P0 invariant fails, keep PR #46 draft and do not publish.

## Release prerequisite

Enable GitHub Release Immutability in repository `Settings -> Releases` before publishing v1.9.37, then verify tag/assets/checksums/attestation. Merge/release remain separate user-controlled steps.

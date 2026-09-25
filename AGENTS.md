# TESSA Matrix Studio repository rules

- Treat tag `v1.16.15` / commit `ad9f86e` as the immutable rollback baseline.
- Canonical source is `src/core.user.js` plus `src/uat/full-uat.js` and `src/runtime/interval-add-valid-fallback.js`; build with `tools/build-candidate.mjs`. Do not recreate a hotfix chain.
- Production must not expose `__TESSA_MATRIX_SYNC_EXPORTS__` or `__TMS_FULL_UAT_V1__`. Full UAT belongs to the exact UAT build and test contour.
- Preserve fail-closed behavior for stale versions, ambiguous dictionaries, CardTypeID-scoped document types, writer locks, ACL failures and cross-matrix transfers.
- For user evidence, copy archives into `dist/private-evidence/YYYY-MM-DD`; never commit business Excel, raw TESSA responses or diagnostics.
- Analyze uploaded Excel through `readXlsxArrayBuffer` and `buildPlan` from the exact candidate. Do not infer before/after from filenames.
- Add focused regression coverage for every production or live UAT failure, then run `npm test` against the rebuilt exact candidate.
- Keep production and UAT versioned from `package.json`. Update README, changelog, issue template and release checks together.
- A release requires server ACL evidence and live Full UAT cleanup/restore proof. Client-side button state is not authorization.
- Prefer a short-lived focused branch from `main`, small reviewable commits and an up-to-date PR description.
- Keep one canonical implementation. Historical hotfixes, recovery workflows and generated userscripts belong in Git history or release assets, not in the active tree.

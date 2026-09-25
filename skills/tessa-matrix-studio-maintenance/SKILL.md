---
name: tessa-matrix-studio-maintenance
description: Diagnose, change, test, package, or document the TESSA Matrix Studio repository, especially from Excel, diagnostics, Full UAT, performance, security, or release evidence.
---

# TESSA Matrix Studio maintenance

Read the repository `AGENTS.md` first. Use the canonical source and exact candidate builder; do not patch generated userscripts directly.

When evidence is supplied:

1. Copy it under ignored `dist/private-evidence/YYYY-MM-DD` and preserve the original.
2. Extract nested archives without committing business data.
3. Parse Excel with the candidate exports `readXlsxArrayBuffer` and `buildPlan`; determine before/after from observed plan counts and metadata.
4. Treat Full UAT `cleanup-ledger.json` and `restore-proof.json` as the authority for whether live writes were restored.
5. Trace each failure to a production boundary or UAT-only defect. Never weaken CardTypeID, ACL, stale-version, duplicate, writer-lock, or reconciliation checks to make UAT green.

For changes, edit `src/`, add a regression that reproduces the evidence, run focused tests, rebuild both profiles, then run `npm test`. Production must contain no test globals; Full UAT must remain available in the UAT build.

Before delivery, build a reviewable release directory with production and UAT userscripts, SHA-256 checksums, rollback reference, and concise live steps. Keep private evidence out of Git. Update the draft PR only after local verification succeeds.

When those files exist in the active repository, use `docs/CHANGE-ALGORITHMS.md` for row lifecycle and `docs/CERTIFICATION-CONTROLS.md` for security and release gates.

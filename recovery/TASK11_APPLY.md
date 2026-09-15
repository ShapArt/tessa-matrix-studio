# Task11 apply trigger

This marker intentionally triggers the deterministic Task11 workflow on the v1.14 recovery branch.

Scope: live TESSA-backed value picker without an Excel prerequisite, plus the aggregate XLSX archive false-positive fix while preserving independent ZIP safety guards.

Retry 3: keep the existing TEST_MODE-only injected APP path for DOM tests and remove the last user-facing instruction that incorrectly required downloading Excel when live TESSA dictionaries are unavailable.

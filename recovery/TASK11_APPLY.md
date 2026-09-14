# Task11 apply trigger

This marker intentionally triggers the deterministic Task11 workflow on the v1.14 recovery branch.

Scope: live TESSA-backed value picker without an Excel prerequisite, plus the aggregate XLSX archive false-positive fix while preserving independent ZIP safety guards.

Retry 2: preserve the existing TEST_MODE-only injected APP picker path for DOM regression tests; production still refreshes dictionaries directly from TESSA when no workbook is selected.

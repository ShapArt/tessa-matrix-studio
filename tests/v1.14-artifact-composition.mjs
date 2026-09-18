import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-v114-artifact-'));
const target = path.join(tmp, 'tessa-matrix-studio.user.js');
fs.copyFileSync(path.join(root, 'tessa-matrix-studio.user.js'), target);

const run = (args, env = {}) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return result;
};

try {
  run(['hotfixes/malformed-range-diagnostic-transform.mjs', target]);
  run(['hotfixes/v1.13.0-user-row-lifecycle-transform.mjs', target]);
  fs.appendFileSync(target, `\n${fs.readFileSync(path.join(root, 'hotfixes/interval-add-valid-fallback.js'), 'utf8')}\n`);
  run(['hotfixes/v1.13.0-full-uat-live-finalize.mjs', target]);
  run(['hotfixes/v1.14-full-uat-inline-failures.mjs', target]);
  run(['hotfixes/v1.14-live-uat-final-four.mjs', target]);
  run(['hotfixes/v1.14.1-changes-report-full-row.mjs', target]);
  run(['hotfixes/v1.14.2-live-excel-preview-ux.mjs', target]);
  run(['hotfixes/v1.14.2-preview-counter-filters.mjs', target]);
  run(['hotfixes/v1.14.2-full-uat-scope-fix.mjs', target]);
  run(['hotfixes/v1.14.2-full-uat-deterministic-clear.mjs', target]);
  run(['hotfixes/v1.14.2-full-uat-copied-identity-collision-safe.mjs', target]);
  run(['hotfixes/v1.14.2-full-uat-version-provenance.mjs', target]);
  run(['--check', target]);

  const source = fs.readFileSync(target, 'utf8');
  assert.match(source, /MaxEntryUncompressedBytes:\s*128\s*\*\s*1024\s*\*\s*1024/,
    'release/UAT composition must preserve the canonical 128 MiB strict per-entry ceiling');
  assert.match(source, /MaxTotalUncompressedBytes:\s*512\s*\*\s*1024\s*\*\s*1024/,
    'release/UAT composition must preserve the canonical bounded total archive ceiling');
  assert.match(source, /FULL_UAT_STRICT_APPLY_RESULT_V1/,
    'composed artifact must validate Full UAT writes');
  assert.match(source, /FULL_UAT_ADD_RECEIPT_RECOVERY_V2/,
    'composed artifact must bind temporary-row cleanup to the exact successful ADD receipt');
  assert.match(source, /FULL_UAT_CLEAR_SCENARIO_DETERMINISTIC_V2/,
    'composed artifact must prove SET -> CLEAR -> read-back -> cleanup without a data-shape NOT_RUN');
  assert.doesNotMatch(source, /Не найдено доказанно необязательное заполненное поле временной строки/,
    'exact candidate must not retain the flaky Full UAT CLEAR NOT_RUN branch');
  assert.match(source, /FULL_UAT_VERSION_PROVENANCE_V1/,
    'composed artifact must bind Full UAT evidence to the runtime Studio version');
  assert.match(source, /FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1/,
    'composed artifact must preflight copied identities against business-row duplicates');
  assert.match(source, /studioVersion: String\(E\.studioVersion\?\.\(\) \|\| 'unknown'\)/,
    'Full UAT report must read the runtime Studio version instead of a stale literal');
  assert.doesNotMatch(source, /format: 'TESSA_FULL_UAT_V1', studioVersion: '1\.14\.0'/,
    'Full UAT evidence must not report the stale 1.14.0 version');

  // Live UAT 2026-09-14 showed that every temporary Apply invoked the native editor Save,
  // forcing the tester through repeated TESSA confirmation dialogs. Full UAT already has
  // one explicit write-phase consent and performs its own fresh read-back/cleanup proof.
  // Every internal mutation must therefore defer the main-card Save; exactly one native
  // Save is flushed after all write + recovery cleanup work has finished.
  assert.match(source, /deferMainMatrixSave:\s*true/,
    'Full UAT internal Apply calls must defer the native main-card Save');
  assert.match(source, /FULL_UAT_DEFER_MAIN_SAVE_V1/,
    'applyPlan must expose the scoped deferred-save contract used only by Full UAT');
  assert.match(source, /reason:\s*'deferred-by-caller'/,
    'deferred Apply must record an explicit skipped-save reason instead of silently saving');
  assert.match(source, /FULL_UAT_SINGLE_MAIN_SAVE_V1/,
    'Full UAT must flush one native main-card Save after all write/cleanup operations');
  assert.match(source, /report\.writesCompleted\s*>\s*0[\s\S]{0,900}saveMainMatrixAfterApply\(\)/,
    'the single final Save must be conditional on at least one accepted UAT mutation');
  assert.doesNotMatch(source, /result\.success\s*!==\s*true\s*\|\|\s*result\.status\s*!==\s*'completed'/,
    'Full UAT must not reject an accepted write solely because nested post-write verification reported partial');

  // PR #105 regression: native evidence used to stop before the only final Save. Validate
  // ordering on the fully composed userscript, not merely the transform source markers.
  assert.match(source, /FULL_UAT_RECORDER_THROUGH_FINAL_SAVE_V2/);
  assert.match(source, /FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2/);
  assert.match(source, /FULL_UAT_FAILURE_SUMMARY_V1/);
  assert.match(source, /FULL_UAT_APPLY_FAILURE_EVIDENCE_V3/);
  const saveIndex = source.indexOf('const finalMainSave = await bridge.saveMainMatrixAfterApply();');
  const recorderStopIndex = source.indexOf('const nativeRecord = await E.stopNativeOperationRecorder(false);', saveIndex);
  const verdictIndex = source.indexOf('// FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2', recorderStopIndex);
  assert.ok(saveIndex >= 0, 'composed Full UAT must contain its final native Save');
  assert.ok(recorderStopIndex > saveIndex, 'native recorder must stop only after the final native Save');
  assert.ok(verdictIndex > recorderStopIndex, 'final verdict must be calculated only after Save evidence is closed');
  assert.match(source, /failed-checks\.json/, 'FAILED package must contain machine-readable failed checks');
  assert.match(source, /FAILURES\.txt/, 'FAILED package must contain an immediately readable failure summary');

  // Seeds 29768023 and 1346937433 reproduced the same 29/4 result. The composed candidate
  // must surface exact failures without requiring ZIP extraction.
  assert.match(source, /FULL_UAT_PICKER_SOURCE_V2/);
  assert.match(source, /REFRESH_DICTIONARY_DIRECT_XML_V2/);
  assert.match(source, /FULL_UAT_BOOLEAN_SEMANTIC_V2/);
  assert.match(source, /FULL_UAT_INLINE_FAILURES_V1/);
  assert.match(source, /FAIL DETAILS/);
  assert.match(source, /TESSA_Full_UAT_FAILURES_/);
  assert.match(source, /Array\.isArray\(result\.failedChecks\)/);

  // v1.14.1 report polish + colleague live Preview fixes + counter-driven filtering +
  // the live-UAT-only scope correction must be composed into one exact candidate.
  assert.match(source, /REVIEWED_CHANGES_REPORT_V3/);
  assert.match(source, /LIVE_EXCEL_PREVIEW_UX_V1/);
  assert.match(source, /PREVIEW_COUNTER_FILTERS_V1/);
  assert.match(source, /LIVE_EXCEL_FULL_UAT_SCOPE_FIX_V1/);
  assert.match(source, /live-colleague-picker-multi-position/);
  assert.match(source, /live-colleague-preview-attention/);
  assert.match(source, /live-colleague-preview-counter-filters/);
  assert.match(source, /Не будет применено к TESSA/);
  assert.match(source, /data-resolution-page/);
  assert.match(source, /data-preview-counter-filter=\"add\"/);
  assert.match(source, /button\[data-preview-counter-filter\]/);
  assert.match(source, /aria-pressed=/);
  assert.doesNotMatch(source, /class=\"tms-preview-filters\"/,
    'exact candidate must not contain duplicated lower Preview filter controls');
  assert.match(source, /const text = E\.pickerSelectionText\(\[item\]\);/);
  assert.match(source, /const summary = E\.previewAttentionSummary\(syntheticPlan, E\.createPlanReviewState\(\)\);/);
  assert.match(source, /const windowed = E\.resolutionCenterWindow\(/);
  assert.doesNotMatch(source, /const text = pickerSelectionText\(\[item\]\);/);
  assert.doesNotMatch(source, /const summary = previewAttentionSummary\(syntheticPlan, createPlanReviewState\(\)\);/);
  assert.doesNotMatch(source, /const windowed = resolutionCenterWindow\(Array\.from\(/);

  run(['tests/user-copied-identity-regression.mjs'], { TMS_TEST_SOURCE: target });
  run(['tests/full-uat-runner-contract.mjs'], { TMS_TEST_SOURCE: target });
  run(['tests/live-uat-regressions.mjs'], { TMS_TEST_SOURCE: target });
  run(['tests/live-colleague-excel-regressions.mjs'], { TMS_TEST_SOURCE: target });
  run(['tests/v1.14.2-full-uat-clear-regression.mjs'], { TMS_TEST_SOURCE: target });
  run(['tests/v1.14.2-full-uat-version-provenance.mjs'], { TMS_TEST_SOURCE: target });
  run(['tests/v1.14.2-full-uat-copied-identity-regression.mjs'], { TMS_TEST_SOURCE: target });

  console.log('v1.14 release/UAT artifact composition: write safety + report V3 + live Excel UX + counter filters + deterministic Full UAT CLEAR + collision-safe copied identities + version provenance OK');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

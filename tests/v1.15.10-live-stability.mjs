import fs from 'node:fs';
import assert from 'node:assert/strict';
import { applyV11510LiveStability } from '../hotfixes/v1.15.10-live-stability.mjs';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
let source = fs.readFileSync(sourcePath, 'utf8');

source = source
  .replace(/^(\/\/ @version\s+)[0-9.]+$/m, '$11.16.0')
  .replace(/(^\s*version:\s*')[0-9.]+(',\s*$)/m, '$11.16.0$2');

const output = applyV11510LiveStability(source);
assert.equal(applyV11510LiveStability(output), output, 'transform must be idempotent');

for (const marker of [
  "buildFingerprint: 'TMS_V1_15_10_PAGING_V4_REFRESH_EDIT_V2'",
  "performanceBuild: APP.performanceBuild",
  "TMS_V1_16_0_PERF_ENDGAME_V1",
  'SERVER_PAGED_NATIVE_VIEW_V4',
  'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V4',
  'paging-parameter-factory',
  'getPageLimitParameter',
  'getPageOffsetParameter',
  'target-setupPagingParameters-array',
  'component-setupPagingParameters-array',
  'UAT_REAL_XLSX_EDIT_V2',
  'PROD_SMOKE_DIAGNOSTICS_V1',
  'candidates: quickMode ? 40 : 200',
  'const performanceRows = quickMode ? 300 : 3000;',
  'patchWorkbookVisibleCellForUat',
  "'candidate-build-provenance'",
  "'dictionary-refresh', 'Обновление справочников в изменённом Excel без потери правки'",
  'физическая пользовательская правка XLSX должна давать ровно 1 UPDATE',
]) {
  assert.ok(output.includes(marker), 'missing v1.16.0 marker: ' + marker);
}

assert.ok(!output.includes('TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V2'), 'old paging diagnostics V2 must not survive');
assert.ok(!output.includes('requestedStrategy\":\"explicit-special'), 'old explicit-special diagnostics must not survive');
assert.ok(!output.includes('requestedStrategy\":\"live-state-setup'), 'old live-state diagnostics must not survive');

const refreshStart = output.indexOf("await runCheck('dictionary-refresh'");
const refreshEnd = output.indexOf("await runCheck('merge-current'", refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'dictionary refresh UAT block missing');
const refreshBlock = output.slice(refreshStart, refreshEnd);
assert.ok(refreshBlock.includes('patchWorkbookVisibleCellForUat'), 'dictionary refresh UAT must patch physical XLSX');
assert.ok(refreshBlock.includes('visibleAfter'), 'dictionary refresh UAT must verify visible cell after refresh');
assert.ok(refreshBlock.includes('counts?.update || 0) !== 1'), 'dictionary refresh UAT must require exactly one update');
assert.ok(!refreshBlock.includes('edited?.book || cloneWorkbook'), 'old in-memory-only refresh setup must be absent');

console.log('v1.16.0 live stability transform: PASS');

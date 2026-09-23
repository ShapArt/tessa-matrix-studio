import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = process.env.TMS_TEST_SOURCE || new URL('../tessa-matrix-studio.user.js', import.meta.url).pathname;
const source = fs.readFileSync(sourcePath, 'utf8');

// Live seed 273171831 proved V9 still lost MatrixID and also called an out-of-scope
// planner helper from the UAT fixture. TESSA 4.1 renamed Web ViewRequest.values to
// parameters, so the direct adapter must preserve both API generations explicitly.
assert.match(source, /SERVER_PAGED_NATIVE_VIEW_V(?:10|11|12|13)/);
assert.match(source, /TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V(?:10|11|12|13)/);
assert.match(source, /TMS_V1_16_9_PAGING_V10_VERSIONED_CONTEXT/);
assert.match(source, /'parameters' in request/);
assert.match(source, /'values' in request/);
assert.match(source, /nativeRequest\.parameters\s*\?\?\s*nativeRequest\.Parameters\s*\?\?\s*nativeRequest\.values\s*\?\?\s*nativeRequest\.Values/);
assert.match(source, /await getBaseParameters\(\)/);
assert.match(source, /mergeContextParameters/);
assert.match(source, /contextParameterNames/);
assert.match(source, /requiredContextPresent/);
assert.match(source, /MatrixID/);

// Production buildPlan already performs role-validation. The UAT fixture must validate
// the resulting physical plan, not call a private helper that is outside its scope.
const helperStart = source.indexOf('async function findPhysicalSafeUpdateCandidate');
const helperEnd = source.indexOf('function findRowByCard', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'physical safe-update helper must exist');
const helper = source.slice(helperStart, helperEnd);
assert.doesNotMatch(helper, /resultingRoleCountForAction\(/);
assert.match(helper, /physicalPlan\.counts\?\.update/);
assert.match(helper, /physicalPlan\.counts\?\.skip/);

console.log('v1.16.9 versioned view context + physical UAT scope regression: PASS');
